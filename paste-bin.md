# Paste Bin - System Design

## 1. 📋 Đề Bài (Problem Statement)
- Thiết kế hệ thống Paste Bin tương tự Pastebin.com / GitHub Gist, cho phép người dùng lưu trữ và chia sẻ đoạn text/code qua một URL ngắn duy nhất.
- Hệ thống phải hỗ trợ paste lớn (lên đến vài MB), syntax highlighting, và các chế độ truy cập (public, unlisted, private).
- **Scope chính** (in scope):
  - Tạo paste mới (với nội dung text/code)
  - Đọc paste qua unique URL
  - Syntax highlighting cho nhiều ngôn ngữ
  - Chế độ truy cập: public, unlisted, private
  - Thời gian hết hạn (expiration)
  - Basic analytics (view count)
- **Scope ngoài bài** (out of scope): real-time collaborative editing, version history/diff, file attachments (binary), comment system, fork/clone.
- **Mục tiêu business**: cung cấp nền tảng chia sẻ code/text nhanh chóng, an toàn, hỗ trợ developer workflow và troubleshooting.

## 2. 🔍 Requirement Gathering & Analysis

### 2.1 Functional Requirements
| Priority | Requirement | Mô tả |
|---|---|---|
| MUST-HAVE | Create paste | User nhập nội dung text/code, chọn ngôn ngữ, nhận về unique URL |
| MUST-HAVE | Read paste | Truy cập URL để xem nội dung paste với syntax highlighting |
| MUST-HAVE | Expiration | Paste tự hết hạn theo thời gian (10 min, 1 hour, 1 day, 1 week, 1 month, never) |
| MUST-HAVE | Access control | 3 chế độ: public (searchable), unlisted (chỉ ai có link), private (chỉ owner) |
| MUST-HAVE | Raw content | Endpoint trả về raw text (không HTML) để dễ curl/wget |
| NICE-TO-HAVE | Syntax highlighting | Highlight code theo ngôn ngữ được chọn (client-side rendering) |
| NICE-TO-HAVE | User management | Đăng ký/đăng nhập để quản lý pastes, xem history |
| NICE-TO-HAVE | Delete paste | Owner có thể xóa paste trước khi hết hạn |
| NICE-TO-HAVE | Burn after read | Paste tự hủy sau lần đọc đầu tiên |

### 2.2 Non-Functional Requirements
- **Performance**: Read paste p95 < 100ms (cache hit), create paste p95 < 300ms (bao gồm upload content lên S3).
- **Scalability**: Hỗ trợ peak ~1,500 read QPS và ~300 write QPS.
- **Availability**: SLA 99.99% cho read path, 99.9% cho create/manage API.
- **Consistency**: Read-after-write consistency cho paste mới tạo (<2s). View count chấp nhận eventual consistency.
- **Security**: JWT/OAuth2 cho user APIs, TLS end-to-end, content scanning chống abuse (malware links, PII leak).
- **Cost**: Ước lượng ~$2,500-4,000/tháng cho MVP (EKS cluster ~$800, RDS Multi-AZ ~$500, ElastiCache ~$300, S3 ~$200, CloudFront ~$300, MSK ~$400, monitoring ~$200). Scale lên peak traffic có thể đạt $6,000-8,000/tháng.
- **Observability**: Golden Signals (latency, error, traffic, saturation), distributed tracing cho read/write paths.

### 2.3 Capacity Estimation (Back-of-the-envelope)

#### Bước 0: Quy ước đơn vị
- `1 day = 86,400 seconds`
- `1M = 1,000,000`, `1B = 1,000,000,000`
- Dùng đơn vị thập phân: `1KB = 1,000B`, `1GB = 1,000,000,000B`

#### Bước 1: Inputs giả định
| Input | Giá trị | Tại sao chọn |
|---|---|---|
| DAU | 10M users/day | Scale trung bình, nhỏ hơn URL shortener (paste ít viral hơn) |
| New pastes/day | 5M pastes/day | ~50% DAU tạo 1 paste/ngày |
| Avg views per paste/day | 5 views | Paste thường chia sẻ trong nhóm nhỏ (team, forum) |
| Avg paste content size | 5KB | Code snippets, logs, configs trung bình |
| Metadata per paste | 300B | id, short_code, title, language, visibility, user_id, timestamps, s3_key |
| Avg read response payload | 8KB | Content + HTML wrapper + headers |

> 📌 `5KB` là trung bình; hệ thống hỗ trợ paste lên đến **10MB** nhưng đa số paste < 10KB.

#### Bước 2: Tính write traffic (create paste)
- Công thức: `write_qps_avg = new_pastes_per_day / 86,400`
- Thay số: `5,000,000 / 86,400 = 57.87`
- Kết quả: **write QPS trung bình ~58**
- Peak factor `x5`: `58 * 5 = 290`
- Kết quả: **peak write QPS ~290**

#### Bước 3: Tính read traffic (view paste)
- Công thức: `daily_views = new_pastes_per_day * avg_views_per_paste`
- Thay số: `5,000,000 * 5 = 25,000,000 views/day`
- Công thức: `read_qps_avg = daily_views / 86,400`
- Thay số: `25,000,000 / 86,400 = 289.35`
- Kết quả: **read QPS trung bình ~289**
- Peak factor `x5`: `289 * 5 = 1,445`
- Kết quả: **peak read QPS ~1,445**

#### Bước 4: Tính content storage (S3)
- Daily raw content: `5,000,000 * 5KB = 25,000,000KB = 25GB/day`
- Yearly raw content: `25GB * 365 = 9,125GB ≈ 9.13TB/year`
- 5-year raw content: `9.13TB * 5 = 45.63TB`
- Tuy nhiên, nhiều paste sẽ expire trước 5 năm. Giả sử ~60% paste expire trong 30 ngày:
  - Active storage sau 5 năm ước lượng: `45.63TB * 0.4 = 18.25TB` (active) + rolling expired data

> 📌 Content được gzip compress trước khi lưu S3, ratio trung bình ~3:1 cho text → actual storage **~15TB** sau 5 năm.

#### Bước 5: Tính metadata storage (PostgreSQL)
- Daily metadata: `5,000,000 * 300B = 1,500,000,000B = 1.5GB/day`
- Yearly metadata: `1.5GB * 365 = 547.5GB/year`
- 5-year metadata: `547.5GB * 5 = 2,737.5GB ≈ 2.74TB`
- Cộng index + replication (3x): `~8.2TB`

#### Bước 6: Tính bandwidth
- Read bandwidth/day: `25,000,000 * 8KB = 200,000,000KB = 200GB/day`
- Write bandwidth/day: `5,000,000 * 5KB = 25GB/day`
- Total bandwidth/day: `225GB/day`

#### Bước 7: Redis cache memory estimate
- Hot pastes (top 5% được truy cập nhiều): `5,000,000 * 0.05 * 5KB = 1,250,000KB = 1.25GB` active set mỗi ngày
- Giả sử cache window 7 ngày hot pastes: `1.25GB * 7 = 8.75GB`
- Cộng Redis overhead + replication (2x): **~18GB**

#### Bước 8: So sánh kịch bản
| Kịch bản | Avg paste size | Daily content storage | Daily metadata | Peak read QPS |
|---|---|---|---|---|
| Base (small pastes) | 2KB | 10GB/day | 1.5GB/day | ~1,445 |
| Conservative (đang dùng) | 5KB | 25GB/day | 1.5GB/day | ~1,445 |
| Large pastes scenario | 10KB | 50GB/day | 1.5GB/day | ~1,445 |

> 📌 Content size ảnh hưởng chủ yếu đến storage và bandwidth, không ảnh hưởng nhiều đến QPS.

#### Bước 9: 📊 Bảng tổng hợp Capacity Estimation

| ID | Metric | Avg | Peak | Quyết định được drive bởi số liệu này |
|---|---|---|---|---|
| C1 | Write QPS | ~58 | **~290** | §3.2 Chọn S3 (DB không chịu 25GB/day inline) · §10 HPA paste-service min=2, max=10 |
| C2 | Read QPS | ~289 | **~1,445** | §3.4 Chọn cache-aside Redis · §10 HPA read-service min=3, max=20 · §10 Caching TTL strategy |
| C3 | Content storage/year (S3) | **~9.13TB** | — | §3.2 Chọn S3 thay PostgreSQL inline · §8 S3 key prefix `YYYY/MM` tránh hot partition · §15 S3 cross-region replication |
| C4 | Metadata storage/year (PostgreSQL) | **~547.5GB** | — | §8 Range partition monthly · §10 RDS instance sizing (db.r6g.xlarge) · §15 RDS Multi-AZ |
| C5 | Read bandwidth/day | **200GB** | — | §10 CloudFront cache L1 giảm origin traffic · §2.2 Cost estimate CloudFront ~$300 |
| C6 | Redis cache memory | **~18GB** | — | §10 ElastiCache sizing (r6g.large 2-node cluster) · §10 Eviction `allkeys-lru` + TTL dynamic |
| C7 | Daily new pastes | **5M** | — | §8 Partition monthly (~150M rows/partition) · §14 Cleanup job batch size · §16 Effort sizing |

> 📌 **Nguyên tắc cốt lõi**: Mỗi metric trên trực tiếp justify ít nhất một quyết định thiết kế ở §3–§16. Ngược lại, mỗi quyết định sizing/scaling phải truy nguồn về một metric trong bảng này.

## 3. ⚖️ Trade-offs

### 3.1 Bảng tổng quan quyết định
| Decision | Option A | Option B | Chọn | Lý do chính |
|---|---|---|---|---|
| Content storage | PostgreSQL (inline) | **S3 (object store)** | B | Content lớn (lên đến 10MB), tách biệt metadata vs blob |
| ID generation | UUID v4 | **Snowflake + Base62** | B | Consistent với URL shortener, sortable, compact URL |
| Syntax highlighting | Server-side rendering | **Client-side (Prism.js)** | B | Giảm CPU server, flexible, không block response |
| Cache layer | Write-through | **Cache-aside Redis** | B | Phù hợp read-heavy, tránh cache pollution từ one-time pastes |
| Content compression | Không compress | **gzip trước khi lưu S3** | B | Giảm 60-70% storage cost, text compress rất tốt |
| Expiration cleanup | Sync delete on read | **Async background job** | B | Không ảnh hưởng read latency, batch delete hiệu quả |

### 3.2 Decision #1: Content Storage (PostgreSQL inline vs S3)

| Tiêu chí | PostgreSQL inline | S3 object store |
|---|---|---|
| Max content size | Bị giới hạn bởi row size (1GB TOAST nhưng thực tế ~10MB hiệu quả) | Gần như không giới hạn (5TB/object) |
| Read latency | Nhanh cho small content (single query) | Thêm 1 hop đến S3 (~20-50ms) |
| Storage cost | Đắt (EBS-backed RDS) | Rẻ hơn ~10x (S3 Standard) |
| Backup/restore | Chậm hơn khi DB lớn | Content tách riêng, DB backup nhẹ hơn |
| CDN integration | Khó cache từ DB trực tiếp | Dễ dàng serve qua CloudFront + S3 origin |
| Query complexity | Simple JOIN | Cần 2 calls (metadata DB + content S3) |

#### Option A: PostgreSQL inline hoạt động thế nào?
1. User submit paste content.
2. Service INSERT cả metadata + content vào cùng 1 row (hoặc linked table).
3. PostgreSQL tự động TOAST nếu content > 2KB (compress + out-of-line storage).
4. Read: single SELECT query trả về metadata + content.

**Ví dụ**:
1. User paste 8KB code Python.
2. `INSERT INTO pastes (id, short_code, title, language, content, ...) VALUES (...)`.
3. PostgreSQL TOAST compress `content` column → lưu ngoài main table page.
4. Read: `SELECT * FROM pastes WHERE short_code = 'abc123'` → trả cả content trong 1 query.
5. Vấn đề: DB phình nhanh (25GB content/ngày), backup chậm, DB connection bị hold lâu khi đọc large paste.

#### Option B: S3 object store hoạt động thế nào?
1. User submit paste content.
2. Service upload content lên S3 (key = `pastes/{short_code}`).
3. Lưu metadata + `s3_key` vào PostgreSQL.
4. Read: query metadata từ DB → fetch content từ S3 (hoặc CloudFront cache).

**Ví dụ**:
1. User paste 8KB code Python.
2. Service gzip compress: 8KB → ~2.5KB.
3. Upload S3: `PUT s3://paste-content/pastes/L8E3B1JoxM` (2.5KB).
4. Insert DB: `INSERT INTO paste_metadata (id, short_code, s3_key, content_size, ...) VALUES (...)` (~300B row).
5. Read flow:
   - Client GET `/p/L8E3B1JoxM`
   - Check Redis cache → miss
   - Query DB: metadata (1ms)
   - Fetch S3: content (~20ms, hoặc CloudFront hit ~5ms)
   - Response: metadata + content (~25ms total)
6. Ưu điểm: DB chỉ lưu metadata (1.5GB/day vs 26.5GB/day), backup nhanh, S3 rẻ và bền.

#### Pseudo-code so sánh
```text
PostgreSQL inline:
content = request.body
record = { shortCode, title, language, content, ... }
db.insert("pastes", record)       // single insert, DB grows fast
return db.select("pastes", shortCode)  // single query

S3 + PostgreSQL:
content = gzip(request.body)
s3.put("pastes/" + shortCode, content)        // upload to S3
metadata = { shortCode, title, language, s3Key, ... }
db.insert("paste_metadata", metadata)         // lightweight insert
// read:
meta = db.select("paste_metadata", shortCode) // fast query
content = s3.get(meta.s3Key)                  // separate fetch
return { meta, gunzip(content) }
```

#### Kết luận
- **Context**: paste content lớn (avg 5KB, max 10MB), storage growth 25GB/day, cần CDN integration.
- **Chọn S3** vì: tách biệt hot metadata (DB nhỏ, query nhanh) và cold content (S3 rẻ, scalable). CloudFront có thể cache S3 objects trực tiếp.
- **Mitigation cho thêm 1 hop**: cache popular pastes trong Redis (content + metadata), serve từ CloudFront cho raw content.

### 3.3 Decision #2: Syntax Highlighting (Server-side vs Client-side)

| Tiêu chí | Server-side (Pygments/highlight.js SSR) | Client-side (Prism.js/highlight.js) |
|---|---|---|
| Server CPU cost | Cao — mỗi request cần render HTML | Thấp — server chỉ trả raw text + language hint |
| Cache efficiency | Phải cache rendered HTML (lớn hơn raw) | Cache raw content (nhỏ hơn), client render |
| Time to First Byte | Chậm hơn (render trước khi trả) | Nhanh hơn (trả raw ngay) |
| Language support update | Cần deploy lại server | Update JS bundle, không cần deploy backend |
| SEO | HTML sẵn sàng cho crawlers | Cần SSR fallback cho SEO (nếu cần) |

#### Kết luận
- **Chọn client-side (Prism.js)** vì: giảm CPU server, cache hiệu quả hơn (raw text nhỏ hơn rendered HTML), và thêm ngôn ngữ mới chỉ cần update frontend bundle.
- **Mitigation**: server trả `language` field trong metadata để client biết dùng grammar nào. Fallback: nếu client không hỗ trợ language → hiển thị plain text.

### 3.4 Decision #3: Expiration Cleanup Strategy

| Tiêu chí | Sync delete on read | Async background job |
|---|---|---|
| Read latency impact | Thêm delete operation trên critical path | Không ảnh hưởng read |
| Cleanup completeness | Chỉ cleanup khi có access | Cleanup mọi expired paste theo schedule |
| Storage reclaim speed | Chậm (chỉ khi access) | Nhanh (batch job chạy định kỳ) |
| Implementation complexity | Đơn giản (check TTL trong read) | Cần scheduled job + S3 lifecycle |

#### Kết luận
- **Chọn async background job** kết hợp với:
  - **S3 Lifecycle Policy**: tự động delete objects sau TTL (dựa trên object tags).
  - **DB cleanup job**: chạy mỗi 15 phút, batch delete expired metadata (soft delete → hard delete sau 7 ngày).
  - **Read-time check**: vẫn check `expire_at` khi read, trả 410 Gone nếu expired (lazy validation).
- Mitigation: S3 lifecycle là hàng rào cuối cùng đảm bảo không tốn storage cho expired content.

## 4. 🧩 Defining Entities / Components

```mermaid
flowchart TB
    subgraph Edge["Edge Layer"]
        CDN[CloudFront CDN]
        WAF[AWS WAF]
    end

    subgraph Application["Application Layer"]
        GW[API Gateway]
        PS[Paste Service]
        RS[Read Service]
        US[User Service]
        CS[Cleanup Service]
    end

    subgraph Data["Data Layer"]
        DB[(PostgreSQL)]
        CACHE[(Redis)]
        S3[(S3 Content Store)]
    end

    subgraph Async["Async Layer"]
        KAFKA[Kafka]
        ANALYTICS[Analytics Service]
    end

    subgraph Observability["Observability"]
        PROM[Prometheus]
        GRAF[Grafana]
        ELK[ELK Stack]
    end

    CDN --> WAF --> GW
    GW --> PS
    GW --> RS
    GW --> US
    PS --> DB
    PS --> S3
    PS --> CACHE
    RS --> CACHE
    RS --> DB
    RS --> S3
    RS --> KAFKA
    CS --> DB
    CS --> S3
    KAFKA --> ANALYTICS
    ANALYTICS --> DB

    PS -.metrics.-> PROM
    RS -.metrics.-> PROM
    PROM -.-> GRAF
    PS -.logs.-> ELK
    RS -.logs.-> ELK
```

| Component | Vai trò |
|---|---|
| CloudFront CDN | Cache raw content, giảm latency cho users toàn cầu |
| AWS WAF | Chặn DDoS, rate limit, content filtering |
| API Gateway | Routing, authentication, rate limiting, request validation |
| Paste Service | Xử lý tạo paste mới: validate, compress, upload S3, lưu metadata |
| Read Service | Xử lý đọc paste: check cache → DB metadata → S3 content |
| User Service | Đăng ký, đăng nhập, quản lý user profile và paste history |
| Cleanup Service | Background job xóa expired pastes (DB metadata + S3 objects) |
| PostgreSQL | Lưu paste metadata, user data, index cho search |
| Redis | Cache hot paste metadata + content, session cache |
| S3 | Lưu paste content (gzip compressed), lifecycle policy cho auto-expiry |
| Kafka | Event stream cho analytics (view events, create events) |
| Analytics Service | Consume events từ Kafka, aggregate view counts, update DB |
| Prometheus + Grafana | Metrics collection và dashboards |
| ELK Stack | Centralized logging và search |

## 5. 🔗 Client-Server Connection

- **Protocol**:
  - REST (HTTPS) cho tất cả CRUD operations (create, read, delete paste).
  - REST cho raw content endpoint (`GET /raw/{shortCode}` trả `text/plain`).
  - WebSocket: không cần (không có real-time features trong scope).

- **Authentication**:
  - JWT Bearer token cho authenticated endpoints (create paste with user, delete, list my pastes).
  - Anonymous access cho: tạo paste không cần login (guest paste), đọc public/unlisted paste.
  - Private paste: yêu cầu JWT + owner check.

- **Connection patterns**:
  - Request-Response: tất cả client interactions.
  - Async event publishing: Read Service → Kafka (view event) sau khi trả response.

- **Rate limiting & throttling**:
  | Role | Create limit | Read limit | Thuật toán |
  |---|---|---|---|
  | Anonymous | 10 pastes/hour, max 64KB/paste | 60 reads/min | Token bucket |
  | Authenticated (free) | 50 pastes/hour, max 1MB/paste | 300 reads/min | Token bucket |
  | Authenticated (pro) | 500 pastes/hour, max 10MB/paste | 3000 reads/min | Token bucket |

- **Idempotency**:
  - `POST /api/v1/pastes` hỗ trợ `Idempotency-Key` header để tránh duplicate paste khi client retry.
  - Server lưu idempotency key trong Redis (TTL 24h), trả về kết quả cũ nếu key đã tồn tại.

## 6. 🔄 System / App Flow

### Flow 1: Create Paste

```mermaid
sequenceDiagram
    actor U as User
    participant GW as API Gateway
    participant PS as Paste Service
    participant IDG as ID Generator
    participant S3 as S3
    participant DB as PostgreSQL
    participant CACHE as Redis
    participant K as Kafka

    U->>GW: POST /api/v1/pastes {content, language, visibility, expireIn}
    GW->>GW: Validate JWT (if present), rate limit check
    GW->>PS: Forward request

    PS->>PS: Validate input (size, content type)
    PS->>IDG: Generate Snowflake ID
    IDG-->>PS: snowflake_id

    PS->>PS: Base62 encode → short_code
    PS->>PS: gzip compress content

    PS->>S3: PUT pastes/{short_code} (compressed content)
    S3-->>PS: 200 OK

    PS->>DB: INSERT paste_metadata (short_code, language, visibility, expire_at, s3_key, user_id)
    DB-->>PS: Created

    PS->>CACHE: SET paste:{short_code} (metadata + content, TTL=1h)
    CACHE-->>PS: OK

    PS->>K: Publish PasteCreatedEvent (async)

    PS-->>GW: 201 Created {shortCode, pasteUrl, rawUrl, expireAt}
    GW-->>U: 201 Created
```

### Flow 2: Read Paste

```mermaid
sequenceDiagram
    actor U as User
    participant CDN as CloudFront
    participant GW as API Gateway
    participant RS as Read Service
    participant CACHE as Redis
    participant DB as PostgreSQL
    participant S3 as S3
    participant K as Kafka

    U->>CDN: GET /p/{shortCode}
    CDN->>CDN: Check cache

    alt CDN cache hit
        CDN-->>U: 200 OK (cached HTML)
    else CDN cache miss
        CDN->>GW: Forward request
        GW->>RS: GET /p/{shortCode}

        RS->>CACHE: GET paste:{shortCode}
        alt Cache hit
            CACHE-->>RS: metadata + content
        else Cache miss
            RS->>DB: SELECT * FROM paste_metadata WHERE short_code = ?
            DB-->>RS: metadata

            alt Paste not found
                RS-->>GW: 404 Not Found
                GW-->>CDN: 404
                CDN-->>U: 404 Not Found
            else Paste expired
                RS-->>GW: 410 Gone
                GW-->>CDN: 410
                CDN-->>U: 410 Gone
            else Paste found
                RS->>RS: Check visibility (private → require auth)
                RS->>S3: GET pastes/{short_code}
                S3-->>RS: compressed content
                RS->>RS: gunzip decompress
                RS->>CACHE: SET paste:{shortCode} (TTL=1h)
            end
        end

        RS->>K: Publish ViewEvent (async, fire-and-forget)
        RS-->>GW: 200 OK {metadata, content, language}
        GW-->>CDN: 200 OK
        CDN->>CDN: Cache response (TTL=5min for unlisted)
        CDN-->>U: 200 OK
    end
```

### Flow 3: Burn After Read

```mermaid
sequenceDiagram
    actor U as User
    participant GW as API Gateway
    participant RS as Read Service
    participant DB as PostgreSQL
    participant S3 as S3
    participant CACHE as Redis

    U->>GW: GET /p/{shortCode}
    GW->>RS: Forward

    RS->>DB: SELECT * FROM paste_metadata WHERE short_code = ? FOR UPDATE
    DB-->>RS: metadata (burn_after_read = true, read_count = 0)

    RS->>S3: GET pastes/{short_code}
    S3-->>RS: content

    RS->>DB: UPDATE paste_metadata SET status = 'BURNED', read_count = 1
    RS->>S3: DELETE pastes/{short_code}
    RS->>CACHE: DEL paste:{shortCode}

    RS-->>GW: 200 OK {content, burned: true}
    GW-->>U: 200 OK (lần truy cập duy nhất)

    Note over U,CACHE: Lần truy cập sau → 410 Gone
```

### Error handling & Edge cases
| Error case | HTTP Status | Behavior |
|---|---|---|
| Paste not found | 404 Not Found | Trả error response chuẩn |
| Paste expired | 410 Gone | Trả thông báo paste đã hết hạn |
| Paste burned (đã đọc) | 410 Gone | Trả thông báo paste đã bị xóa |
| Private paste, no auth | 401 Unauthorized | Yêu cầu đăng nhập |
| Private paste, wrong user | 403 Forbidden | Không có quyền truy cập |
| Content too large | 413 Payload Too Large | Reject paste > size limit theo plan |
| Rate limit exceeded | 429 Too Many Requests | Trả `Retry-After` header |
| Malformed request | 400 Bad Request | Validation error details |
| S3 down | 503 (degraded) | Serve từ Redis cache nếu có, nếu không → 503 với `Retry-After` |
| Redis down | 200 (degraded) | Fallback đọc trực tiếp từ DB + S3, latency tăng |

## 7. 📡 API Modeling

### Endpoint Definitions
| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | /api/v1/pastes | Optional (guest hoặc authenticated) | Tạo paste mới |
| GET | /api/v1/pastes/{shortCode} | Conditional (private cần auth) | Lấy paste metadata + content |
| GET | /api/v1/pastes/{shortCode}/raw | Conditional | Lấy raw content (text/plain) |
| DELETE | /api/v1/pastes/{shortCode} | Required (owner only) | Xóa paste |
| GET | /api/v1/users/me/pastes | Required | Liệt kê pastes của user |
| GET | /api/v1/pastes/public | None | Liệt kê public pastes (recent) |

### Request/Response Examples

**Create Paste**
```http
POST /api/v1/pastes HTTP/1.1
Host: api.pastebin.example.com
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000

{
  "title": "Quick sort implementation",
  "content": "def quick_sort(arr):\n    if len(arr) <= 1:\n        return arr\n    pivot = arr[len(arr) // 2]\n    left = [x for x in arr if x < pivot]\n    middle = [x for x in arr if x == pivot]\n    right = [x for x in arr if x > pivot]\n    return quick_sort(left) + middle + quick_sort(right)",
  "language": "python",
  "visibility": "unlisted",
  "expireIn": "7d",
  "burnAfterRead": false
}
```

```http
HTTP/1.1 201 Created
Content-Type: application/json
Location: https://pastebin.example.com/p/K9xM3bR2w

{
  "id": "290184726153420800",
  "shortCode": "K9xM3bR2w",
  "title": "Quick sort implementation",
  "language": "python",
  "visibility": "unlisted",
  "pasteUrl": "https://pastebin.example.com/p/K9xM3bR2w",
  "rawUrl": "https://pastebin.example.com/api/v1/pastes/K9xM3bR2w/raw",
  "contentSize": 312,
  "createdAt": "2026-02-28T10:30:00Z",
  "expireAt": "2026-03-07T10:30:00Z",
  "burnAfterRead": false,
  "viewCount": 0
}
```

**Read Paste**
```http
GET /api/v1/pastes/K9xM3bR2w HTTP/1.1
Host: api.pastebin.example.com
Accept: application/json
```

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: public, max-age=300

{
  "id": "290184726153420800",
  "shortCode": "K9xM3bR2w",
  "title": "Quick sort implementation",
  "language": "python",
  "visibility": "unlisted",
  "content": "def quick_sort(arr):\n    if len(arr) <= 1:\n        return arr\n    pivot = arr[len(arr) // 2]\n    left = [x for x in arr if x < pivot]\n    middle = [x for x in arr if x == pivot]\n    right = [x for x in arr if x > pivot]\n    return quick_sort(left) + middle + quick_sort(right)",
  "contentSize": 312,
  "createdAt": "2026-02-28T10:30:00Z",
  "expireAt": "2026-03-07T10:30:00Z",
  "viewCount": 42
}
```

**Read Raw Content**
```http
GET /api/v1/pastes/K9xM3bR2w/raw HTTP/1.1
Host: api.pastebin.example.com
```

```http
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
Cache-Control: public, max-age=300

def quick_sort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quick_sort(left) + middle + quick_sort(right)
```

**Error Response**
```http
HTTP/1.1 410 Gone
Content-Type: application/json

{
  "timestamp": "2026-03-08T10:30:00Z",
  "status": 410,
  "error": "Gone",
  "code": "PASTE_EXPIRED",
  "message": "This paste has expired and is no longer available.",
  "path": "/api/v1/pastes/K9xM3bR2w"
}
```

### Pagination / Filtering / Sorting
- **Strategy**: Cursor-based pagination (dùng `createdAt` + `id` làm cursor) — phù hợp hơn offset cho dataset lớn và liên tục thêm dữ liệu.
- **Filter fields**: `language`, `visibility`, `createdAfter`, `createdBefore`.
- **Sort**: `createdAt` (desc mặc định), `viewCount`.
- **Page size**: default 20, max 100.
- Ví dụ: `GET /api/v1/users/me/pastes?language=python&cursor=eyJpZCI6MjkwMTg0...&limit=20`

### API Versioning
- Strategy: path-based (`/api/v1/...`).
- Deprecation policy: dual-run ít nhất 6 tháng, gửi `Deprecation` header trên v1 khi v2 sẵn sàng.

## 8. 🗄️ Data Modeling

### Database Schema

```sql
CREATE TABLE users (
    id              BIGINT          PRIMARY KEY,
    username        VARCHAR(50)     NOT NULL UNIQUE,
    email           VARCHAR(255)    NOT NULL UNIQUE,
    password_hash   VARCHAR(255)    NOT NULL,
    plan            VARCHAR(20)     NOT NULL DEFAULT 'free'
                                    CHECK (plan IN ('free', 'pro', 'enterprise')),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE paste_metadata (
    id              BIGINT          PRIMARY KEY,
    short_code      VARCHAR(12)     NOT NULL UNIQUE,
    title           VARCHAR(255),
    language        VARCHAR(50)     NOT NULL DEFAULT 'plaintext',
    visibility      VARCHAR(10)     NOT NULL DEFAULT 'unlisted'
                                    CHECK (visibility IN ('public', 'unlisted', 'private')),
    status          VARCHAR(10)     NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active', 'expired', 'burned', 'deleted')),
    s3_key          VARCHAR(255)    NOT NULL,
    content_size    INTEGER         NOT NULL,
    user_id         BIGINT          REFERENCES users(id) ON DELETE SET NULL,
    burn_after_read BOOLEAN         NOT NULL DEFAULT FALSE,
    view_count      INTEGER         NOT NULL DEFAULT 0,
    expire_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE paste_view_daily (
    paste_id        BIGINT          NOT NULL REFERENCES paste_metadata(id) ON DELETE CASCADE,
    view_date       DATE            NOT NULL,
    view_count      INTEGER         NOT NULL DEFAULT 0,
    PRIMARY KEY (paste_id, view_date)
);

CREATE TABLE idempotency_keys (
    idempotency_key VARCHAR(64)     PRIMARY KEY,
    response_body   JSONB           NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
```

### ER Diagram

```mermaid
erDiagram
    USERS {
        bigint id PK
        varchar username UK
        varchar email UK
        varchar password_hash
        varchar plan
        timestamptz created_at
        timestamptz updated_at
    }

    PASTE_METADATA {
        bigint id PK
        varchar short_code UK
        varchar title
        varchar language
        varchar visibility
        varchar status
        varchar s3_key
        integer content_size
        bigint user_id FK
        boolean burn_after_read
        integer view_count
        timestamptz expire_at
        timestamptz created_at
        timestamptz updated_at
    }

    PASTE_VIEW_DAILY {
        bigint paste_id PK,FK
        date view_date PK
        integer view_count
    }

    USERS ||--o{ PASTE_METADATA : "owns"
    PASTE_METADATA ||--o{ PASTE_VIEW_DAILY : "has daily views"
```

### Indexing Strategy
| Index | Columns | Loại | Phục vụ query |
|---|---|---|---|
| `idx_paste_short_code` | `short_code` | UNIQUE | Lookup paste by short code (read path critical) |
| `idx_paste_user_id` | `user_id` | B-tree | List pastes by user (`GET /users/me/pastes`) |
| `idx_paste_visibility_created` | `visibility, created_at DESC` | Composite | List public pastes sorted by recent |
| `idx_paste_expire_at` | `expire_at` | B-tree, partial (`WHERE status = 'active' AND expire_at IS NOT NULL`) | Cleanup job tìm expired pastes |
| `idx_paste_status` | `status` | B-tree, partial (`WHERE status = 'active'`) | Filter active pastes |
| `idx_view_daily_date` | `view_date` | B-tree | Cleanup old analytics data |

### Partitioning / Sharding Strategy
- **paste_metadata**: Range partition theo `created_at` (monthly partitions).
  - Partition giúp cleanup nhanh: `DROP PARTITION` cho tháng cũ thay vì `DELETE` hàng triệu rows.
  - Khi cần shard (>10TB metadata): hash partition theo `short_code` trên application level (consistent hashing).
- **paste_view_daily**: Range partition theo `view_date` (monthly).
  - Dễ dàng drop partition cũ sau khi rollup vào monthly aggregate.
- **S3**: tự động distributed, key prefix `pastes/{YYYY}/{MM}/{short_code}` để tránh S3 hot partition.

### Data Retention Policy
| Loại data | Retention | Strategy |
|---|---|---|
| Active paste content (S3) | Theo `expire_at` user chọn | S3 Lifecycle + cleanup job |
| Expired paste metadata | 30 ngày sau expiry | Soft delete → hard delete bởi cleanup job |
| Never-expire pastes | Vĩnh viễn (hoặc 5 năm inactive) | Archive to S3 Glacier sau 1 năm không access |
| Daily view analytics | 90 ngày chi tiết | Rollup → monthly aggregate → delete detail |
| Idempotency keys | 24 giờ | TTL-based cleanup |
| User data | Vĩnh viễn (hoặc theo GDPR request) | Soft delete + anonymize |

> 💡 **Tại sao tách content ra S3?** PostgreSQL row chỉ lưu ~300B metadata, giúp DB size kiểm soát được (~2.74TB/5 năm thay vì ~50TB nếu inline content). Backup nhanh hơn, query nhanh hơn, cost thấp hơn.

## 9. ⚙️ Manager Classes / Services

### Service Decomposition
| Service | Vai trò |
|---|---|
| `paste-service` | Xử lý tạo paste: validate input, generate ID, compress, upload S3, save metadata |
| `read-service` | Xử lý đọc paste: cache lookup, fetch metadata + content, decompress, publish view event |
| `user-service` | Quản lý user registration, authentication, profile |
| `cleanup-service` | Scheduled job xóa expired paste metadata + S3 objects |
| `analytics-service` | Consume view events từ Kafka, aggregate view counts |

### Core Service Classes & Responsibilities
- `PasteCreationService` (`@Service`): orchestrate tạo paste (validate → generate ID → compress → S3 upload → DB insert → cache warm).
- `PasteReadService` (`@Service`): orchestrate đọc paste (cache → DB → S3 → decompress → publish event).
- `ContentStorageService` (`@Service`): abstract S3 operations (upload, download, delete) với gzip compression.
- `IdGeneratorClient` (`@Component`): gọi ID generator service để lấy Snowflake ID.
- `PasteCleanupJob` (`@Component`, `@Scheduled`): batch tìm và xóa expired pastes.
- `ViewEventPublisher` (`@Component`): publish view events tới Kafka (async, fire-and-forget).
- `SecurityConfig` (`@Configuration`): Spring Security + JWT validation, endpoint access rules.
- `CacheService` (`@Service`): abstract Redis operations cho paste caching.

### Backend Code Example (Java / Spring Boot)

```java
@Service
public class PasteCreationService {

    private final PasteMetadataRepository metadataRepository;
    private final ContentStorageService contentStorage;
    private final IdGeneratorClient idGenerator;
    private final CacheService cacheService;

    public PasteCreationService(PasteMetadataRepository metadataRepository,
                                 ContentStorageService contentStorage,
                                 IdGeneratorClient idGenerator,
                                 CacheService cacheService) {
        this.metadataRepository = metadataRepository;
        this.contentStorage = contentStorage;
        this.idGenerator = idGenerator;
        this.cacheService = cacheService;
    }

    @Transactional
    public PasteResponse create(CreatePasteRequest req, Long userId) {
        validateContent(req.content(), req.language());

        long snowflakeId = idGenerator.nextId();
        String shortCode = Base62.encode(snowflakeId);
        String s3Key = "pastes/" + shortCode;

        contentStorage.upload(s3Key, req.content());

        Instant expireAt = req.expireIn() != null
                ? Instant.now().plus(parseDuration(req.expireIn()))
                : null;

        PasteMetadata metadata = PasteMetadata.builder()
                .id(snowflakeId)
                .shortCode(shortCode)
                .title(req.title())
                .language(req.language())
                .visibility(req.visibility())
                .s3Key(s3Key)
                .contentSize(req.content().length())
                .userId(userId)
                .burnAfterRead(req.burnAfterRead())
                .expireAt(expireAt)
                .build();

        metadataRepository.save(metadata);
        cacheService.cachePaste(shortCode, metadata, req.content());

        return PasteResponse.from(metadata);
    }

    private void validateContent(String content, String language) {
        if (content == null || content.isBlank()) {
            throw new BadRequestException("CONTENT_REQUIRED");
        }
        if (content.length() > 10_485_760) { // 10MB
            throw new PayloadTooLargeException("CONTENT_TOO_LARGE");
        }
    }
}
```

```java
@Service
public class PasteReadService {

    private final PasteMetadataRepository metadataRepository;
    private final ContentStorageService contentStorage;
    private final CacheService cacheService;
    private final ViewEventPublisher viewEventPublisher;

    public PasteReadService(PasteMetadataRepository metadataRepository,
                            ContentStorageService contentStorage,
                            CacheService cacheService,
                            ViewEventPublisher viewEventPublisher) {
        this.metadataRepository = metadataRepository;
        this.contentStorage = contentStorage;
        this.cacheService = cacheService;
        this.viewEventPublisher = viewEventPublisher;
    }

    public PasteDetailResponse read(String shortCode, Long currentUserId) {
        // 1. Try cache
        CachedPaste cached = cacheService.getPaste(shortCode);
        if (cached != null) {
            checkAccess(cached.metadata(), currentUserId);
            checkExpiry(cached.metadata());
            viewEventPublisher.publish(shortCode);
            return PasteDetailResponse.from(cached);
        }

        // 2. DB lookup
        PasteMetadata metadata = metadataRepository.findByShortCode(shortCode)
                .orElseThrow(() -> new NotFoundException("PASTE_NOT_FOUND"));

        checkAccess(metadata, currentUserId);
        checkExpiry(metadata);

        // 3. Handle burn after read
        if (metadata.isBurnAfterRead()) {
            return handleBurnAfterRead(metadata);
        }

        // 4. Fetch content from S3
        String content = contentStorage.download(metadata.getS3Key());

        // 5. Cache for next reads
        cacheService.cachePaste(shortCode, metadata, content);

        // 6. Publish view event (async)
        viewEventPublisher.publish(shortCode);

        return PasteDetailResponse.from(metadata, content);
    }

    private void checkExpiry(PasteMetadata metadata) {
        if (metadata.getExpireAt() != null && Instant.now().isAfter(metadata.getExpireAt())) {
            throw new GoneException("PASTE_EXPIRED");
        }
        if ("burned".equals(metadata.getStatus()) || "expired".equals(metadata.getStatus())) {
            throw new GoneException("PASTE_NO_LONGER_AVAILABLE");
        }
    }

    private void checkAccess(PasteMetadata metadata, Long currentUserId) {
        if ("private".equals(metadata.getVisibility())) {
            if (currentUserId == null || !currentUserId.equals(metadata.getUserId())) {
                throw new ForbiddenException("PASTE_PRIVATE");
            }
        }
    }

    @Transactional
    private PasteDetailResponse handleBurnAfterRead(PasteMetadata metadata) {
        String content = contentStorage.download(metadata.getS3Key());
        metadata.setStatus("burned");
        metadataRepository.save(metadata);
        contentStorage.delete(metadata.getS3Key());
        cacheService.evictPaste(metadata.getShortCode());
        return PasteDetailResponse.burned(metadata, content);
    }
}
```

### Frontend Code Example (React + TypeScript)

```tsx
import { useState } from "react";

const LANGUAGES = ["plaintext", "python", "java", "javascript", "typescript", "go", "rust", "sql", "bash", "json", "yaml", "markdown"];
const EXPIRE_OPTIONS = [
  { label: "10 Minutes", value: "10m" },
  { label: "1 Hour", value: "1h" },
  { label: "1 Day", value: "1d" },
  { label: "1 Week", value: "7d" },
  { label: "1 Month", value: "30d" },
  { label: "Never", value: null },
];

interface PasteResponse {
  shortCode: string;
  pasteUrl: string;
  rawUrl: string;
  expireAt: string | null;
}

export function CreatePasteForm() {
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("plaintext");
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("unlisted");
  const [expireIn, setExpireIn] = useState<string | null>("7d");
  const [burnAfterRead, setBurnAfterRead] = useState(false);
  const [result, setResult] = useState<PasteResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/v1/pastes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, language, visibility, expireIn, burnAfterRead }),
      });
      const data: PasteResponse = await res.json();
      setResult(data);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" />

      <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Paste your code or text here..." rows={20} required />

      <select value={language} onChange={(e) => setLanguage(e.target.value)}>
        {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
      </select>

      <select value={visibility} onChange={(e) => setVisibility(e.target.value as "public" | "unlisted" | "private")}>
        <option value="public">Public</option>
        <option value="unlisted">Unlisted</option>
        <option value="private">Private</option>
      </select>

      <select value={expireIn ?? ""} onChange={(e) => setExpireIn(e.target.value || null)}>
        {EXPIRE_OPTIONS.map((o) => <option key={o.label} value={o.value ?? ""}>{o.label}</option>)}
      </select>

      <label>
        <input type="checkbox" checked={burnAfterRead} onChange={(e) => setBurnAfterRead(e.target.checked)} />
        Burn after read
      </label>

      <button type="submit" disabled={loading || !content}>
        {loading ? "Creating..." : "Create Paste"}
      </button>

      {result && (
        <div>
          <p>Paste URL: <a href={result.pasteUrl}>{result.pasteUrl}</a></p>
          <p>Raw URL: <a href={result.rawUrl}>{result.rawUrl}</a></p>
          {result.expireAt && <p>Expires: {new Date(result.expireAt).toLocaleString()}</p>}
        </div>
      )}
    </form>
  );
}
```

### Service Communication Patterns
- **Sync REST**: Gateway → Paste Service / Read Service / User Service qua internal HTTP.
- **Async event**: Read Service → Kafka → Analytics Service (view events).
- **Async event**: Paste Service → Kafka → Analytics Service (create events, optional).
- **Shared libs**: common error model, tracing interceptor, auth principal extractor, Base62 encoder.

## 10. 🏛️ Architecture Design
- Pattern chính: **Microservices + Event-driven analytics + S3 content offload**.
- Read path tối ưu: CloudFront cache (L1) → Redis cache (L2) → DB metadata + S3 content.
- Write path: Gateway → Paste Service → S3 upload (async) + DB insert.
- Deployment trên **AWS EKS** multi-AZ, tách node group cho read-heavy workload.
- RDS PostgreSQL Multi-AZ cho metadata, S3 cho content, ElastiCache Redis cho caching.

```mermaid
flowchart TB
    subgraph Internet
        C[Client/Browsers]
    end

    subgraph AWS_Edge
        R53[Route53]
        CF[CloudFront]
        WAF[AWS WAF]
    end

    subgraph AWS_VPC
        ALB[Application Load Balancer]

        subgraph EKS
            GW[Gateway Pods]
            PS[Paste Service Pods]
            RS[Read Service Pods]
            US[User Service Pods]
            AS[Analytics Service Pods]
            CJ[Cleanup CronJob Pods]
        end

        REDIS[(ElastiCache Redis)]
        RDS[(RDS PostgreSQL Multi-AZ)]
        RR[(RDS Read Replicas)]
        MSK[(Amazon MSK / Kafka)]
        S3[(S3 Content Store)]
        S3G[(S3 Glacier Archive)]
        CW[CloudWatch]
        AMG[Managed Prometheus/Grafana]
    end

    C --> R53 --> CF --> WAF --> ALB --> GW
    GW --> PS
    GW --> RS
    GW --> US
    PS --> S3
    PS --> RDS
    PS --> REDIS
    RS --> REDIS
    RS --> RDS
    RS --> S3
    RS --> MSK
    AS --> MSK
    AS --> RDS
    CJ --> RDS
    CJ --> S3
    RDS --> RR
    S3 -.lifecycle.-> S3G

    GW -.metrics/logs.-> CW
    PS -.metrics/logs.-> AMG
    RS -.metrics/logs.-> AMG
    AS -.metrics/logs.-> AMG
```

### Scaling Strategy
- **Read Service**: HPA theo CPU + custom metric (`read_rps`), min 3 → max 20 pods.
- **Paste Service**: HPA theo CPU, min 2 → max 10 pods.
- **Analytics Service**: VPA (batch workload, memory-intensive Kafka consumer).
- **PostgreSQL**: scale-up instance + read replicas cho list/search queries.
- **Redis**: cluster mode enabled, shard rebalancing khi memory >70%.
- **S3**: tự động scale, không cần quản lý.

### Caching Strategy
- **L1 — CloudFront**: cache public/unlisted paste HTML pages (TTL 5 min). Raw content endpoint cache lâu hơn (TTL 1 hour). Private paste: `Cache-Control: no-store`.
- **L2 — Redis cache-aside**: cache paste metadata + content (decompressed) cho hot pastes. TTL dynamic:
  - Paste mới tạo: TTL 1 hour (warming period).
  - Paste có view_count > 100: TTL 6 hours.
  - Burn-after-read: không cache.
- **Eviction**: `allkeys-lru` trong Redis. Paste lớn (>100KB) không cache content trong Redis, chỉ cache metadata.

### Load Balancing / Gateway / Mesh
- **ALB**: route tất cả traffic vào EKS ingress controller, health check `/actuator/health`.
- **Spring Cloud Gateway**: routing rules, JWT validation, rate limiting (Redis-backed), request logging.
- **Service mesh** (optional): Istio/Linkerd cho mTLS giữa services nội bộ và traffic observability.

### Resilience Patterns
- **Circuit Breaker** (Resilience4j):
  - Read Service → S3: failure threshold 50% trong 20 requests, open 30s.
  - Read Service → Redis: failure threshold 40%, open 15s. Fallback: skip cache, đọc DB + S3.
  - Paste Service → ID Generator: threshold 50%, open 10s. Fallback: trả 503 `Retry-After`.
- **Retry with Backoff**:
  - S3 operations: exponential backoff 100ms → 200ms → 400ms, max 3 retries, jitter ±50ms.
  - DB transient errors: 50ms → 100ms → 200ms, max 3 retries.
- **Bulkhead**:
  - Read Service: separate thread pool (read: 100 threads, burn-after-read: 20 threads).
  - Paste Service: create pool 50 threads, S3 upload pool 30 threads.
- **Timeout**:
  - Redis GET: 5ms. Redis SET: 10ms.
  - S3 GET: 200ms (content có thể lớn). S3 PUT: 2000ms.
  - DB query: 50ms. DB write: 100ms.
- **Graceful Degradation**:
  - Redis down → skip cache, serve từ DB + S3 (latency tăng ~50-100ms nhưng vẫn hoạt động).
  - Kafka down → buffer view events in-memory (bounded queue 5K events), retry publish. Read vẫn trả response, chỉ analytics delay.
  - S3 down → serve từ Redis cache nếu có. Nếu cache miss → 503 với `Retry-After` header.
- **Request Coalescing**: khi multiple requests đọc cùng paste miss cache đồng thời, dùng singleflight pattern — chỉ 1 request fetch S3, các request khác chờ kết quả.

## 11. 🧪 Testing Strategy
- **Unit Testing**: JUnit 5 + Mockito cho service logic (PasteCreationService, PasteReadService, ContentStorageService), coverage target >80%.
- **Integration Testing**: Spring Boot Test + Testcontainers (PostgreSQL, Redis, Kafka, LocalStack cho S3).
- **API Contract Testing**: Spring Cloud Contract giữa Gateway và downstream services.
- **Load Testing**: Gatling kịch bản:
  - Sustained 1,500 read QPS, xác nhận p95 < 100ms.
  - Burst 300 write QPS với 5KB payload, xác nhận p95 < 300ms.
  - Large paste (5MB) upload, xác nhận hoàn thành < 3s.
- **Chaos Engineering**: AWS Fault Injection Simulator:
  - Redis node failure → verify fallback to DB + S3.
  - S3 latency injection (500ms) → verify circuit breaker opens.
  - AZ outage → verify multi-AZ failover < 30s.
- **E2E Testing**: Playwright cho web UI tạo paste, đọc paste, verify syntax highlighting, test burn-after-read.

## 12. 🔒 Security
- **Authentication**: OAuth2/JWT cho management APIs (create authenticated, delete, list my pastes). Anonymous access cho đọc public/unlisted paste và tạo guest paste.
- **Authorization**: Owner-based access control — chỉ owner được delete, edit, hoặc xem private paste.
- **TLS**: HTTPS cho tất cả public endpoints. mTLS nội bộ nếu bật service mesh.
- **Input validation**:
  - Content size limit theo plan (64KB guest, 1MB free, 10MB pro).
  - Chống XSS: sanitize title field. Content hiển thị trong `<pre><code>` escaped context.
  - Chống SSRF: không applicable (paste không fetch external URLs).
- **Content scanning**: optional — scan paste content cho malware signatures, PII patterns (credit card, SSN) bằng async job post-creation. Flag nhưng không block (để giảm false positive impact).
- **DDoS/bot protection**: WAF rate rules + AWS Shield Standard. CAPTCHA cho anonymous paste creation khi rate limit gần ngưỡng.
- **Data protection**: encryption at rest (S3 SSE-KMS, RDS encryption, ElastiCache encryption), encryption in transit (TLS 1.2+).
- **Secrets management**: DB credentials, JWT signing keys, S3 access keys lưu trong AWS Secrets Manager. Inject vào pods qua External Secrets Operator, rotate tự động mỗi 90 ngày.
- **OWASP Top 10 mitigations**:
  - Injection: parameterized queries (Spring Data JPA), no dynamic SQL.
  - Broken auth: JWT short-lived (15 min access token), refresh token rotation.
  - Security misconfiguration: hardened container images, read-only filesystem, non-root user.
- **Compliance**: GDPR right-to-erasure (xóa paste + S3 content + analytics data theo user request). Burn-after-read tự nhiên hỗ trợ privacy-sensitive use cases.

## 13. 📊 Monitoring & Logging

### Key Metrics
| Nhóm | Metrics |
|---|---|
| Latency | p50/p95/p99 read paste latency, create paste latency, S3 upload/download latency |
| Traffic | read RPS, create RPS, raw content RPS, S3 GET/PUT RPS |
| Errors | 4xx/5xx rate, S3 error rate, DB timeout rate, cache miss ratio |
| Saturation | CPU/memory pods, Redis memory%, DB connections, Kafka consumer lag, S3 request rate |

### Logging Strategy
- Structured JSON logs với fields: `traceId`, `shortCode`, `userId`, `statusCode`, `contentSize`, `cacheHit`.
- Log levels:
  - `INFO`: paste created, paste read, paste deleted, cleanup job completed.
  - `WARN`: cache miss, retry attempt, rate limit triggered.
  - `ERROR`: S3 failure, DB failure, circuit breaker opened.
- Centralized logging: ELK/OpenSearch, retention 30 ngày hot + 90 ngày warm.

### SLI / SLO / Error Budget (SRE)
- **SLI read**: tỷ lệ read requests trả về `200/404/410` (non-5xx) trong tổng read requests.
- **SLI create**: p99 latency của `POST /api/v1/pastes` response time.
- **SLO read availability**: 99.99% → error budget = 0.01% = tối đa **4.3 phút downtime/tháng**.
- **SLO create latency**: p99 < 500ms cho 99.5% thời gian đo trong 30-day rolling window.
- **Error budget policy**:
  - Budget > 50%: deploy bình thường, feature releases.
  - Budget 20-50%: canary chặt (5% → 10% → 25% → 100%), tăng bake time.
  - Budget < 20%: freeze feature deployments, chỉ reliability fixes. Postmortem bắt buộc cho incident tiêu > 10% budget.

### Alerting & Incident Response
- Alert nếu `read p95 > 200ms` trong 5 phút.
- Alert nếu `5xx > 1%` trong 3 phút.
- Alert nếu `cache hit ratio < 70%` trong 10 phút.
- Alert nếu `S3 error rate > 0.5%` trong 5 phút.
- Alert nếu `Kafka consumer lag > 100K messages` trong 10 phút.
- Runbook: detect → triage → mitigate → postmortem trong 24h.
- Distributed tracing: OpenTelemetry + Jaeger/X-Ray, trace read flow end-to-end (Gateway → Cache → DB → S3).

## 14. 🔧 Maintenance
- **CI/CD**: GitHub Actions pipeline `build → unit test → integration test → security scan (Trivy + SAST) → build Docker image → deploy staging → smoke test → deploy production`.
- **Database migration**: Flyway versioned migrations, backward-compatible strategy (add column → migrate data → drop old column trong separate release).
- **Dependency management**: Renovate auto-update PRs, SCA scan (Snyk) cho vulnerabilities.
- **Feature flags**: LaunchDarkly (hoặc config service nội bộ) cho rollout burn-after-read, content scanning, new syntax languages.
- **S3 lifecycle management**: review lifecycle rules quarterly, adjust archive thresholds dựa trên access patterns thực tế.
- **Documentation**: OpenAPI/Swagger auto-publish từ Spring annotations, ADR cho mọi architecture decisions.
- **Technical debt**: sprint cuối tháng dành 10-15% capacity xử lý tech debt. Review backlog debt items mỗi quarter.

## 15. 🚀 Deployment Plans
- **Deployment strategy**:
  - Read Service: Canary (5% → 25% → 100%) vì đây là critical path.
  - Paste Service: Rolling update (ít critical hơn, downtime tolerance cao hơn).
  - Gateway: Blue-Green để minimize downtime.
- **Rollback plan**: `kubectl rollout undo`, Flyway undo migration (nếu backward-compatible), feature flag kill-switch cho new features.
- **IaC**: Terraform modules cho:
  - VPC (multi-AZ, public/private subnets)
  - EKS (managed node groups, Fargate profiles)
  - RDS PostgreSQL (Multi-AZ, parameter groups, backup)
  - ElastiCache Redis (cluster mode, encryption)
  - MSK/Kafka (multi-AZ brokers)
  - S3 (content bucket + lifecycle rules + replication)
  - IAM (service roles, pod identity)
  - CloudFront (distribution + S3 origin)
- **Auto-scaling**:
  - HPA: CPU 70% threshold, custom metric `rps` cho read/paste services.
  - VPA: analytics service (memory-intensive).
  - Cluster Autoscaler + Karpenter cho node scaling.
- **Multi-region**: Active-passive (primary region + DR). Route53 health-check failover. S3 cross-region replication cho content. RDS cross-region read replica promote khi failover.
- **Artifacts**: Docker multi-stage build cho Spring Boot apps. Helm charts cho từng service với environment-specific values.
- **Pre-prod gate**: bắt buộc qua integration test + load test (shadow traffic) + smoke test trước production rollout.

## 16. ⏱️ Effort Estimation

### Phase Breakdown & Timeline
| Phase | Duration | Deliverables |
|---|---|---|
| Discovery & Requirements | 1 tuần | Scope, SLA, API contract draft, S3 bucket design |
| Core Paste CRUD MVP | 2 tuần | Create/read/delete APIs, PostgreSQL metadata, S3 content storage, Redis cache |
| User Management & Access Control | 1 tuần | Registration, JWT auth, visibility enforcement, user paste listing |
| Burn-after-read & Expiration | 1 tuần | Burn logic, cleanup scheduled job, S3 lifecycle policies |
| Analytics & Observability | 1 tuần | Kafka view events, view count aggregation, dashboards, alerts |
| Security & Hardening | 1 tuần | WAF rules, content scanning, rate limiting tuning, penetration testing |
| Performance & Production Readiness | 1.5 tuần | Load test, chaos test, runbooks, documentation |
| **Total** | **~8.5 tuần** | **Production v1** |

### Team Composition
| Role | Số lượng | Responsibilities |
|---|---|---|
| Tech Lead | 1 | Architecture decisions, trade-offs review, code review |
| Backend Engineers | 2 | Paste/Read/Cleanup services, S3 integration, Kafka pipeline |
| Frontend Engineer | 1 | Paste creation UI, paste viewer with syntax highlighting, user dashboard |
| DevOps Engineer | 1 | EKS/Terraform/CI-CD, S3 lifecycle, monitoring setup |
| QA Engineer | 1 | Test automation, load testing, chaos testing |

### Risk Assessment
| Risk | Impact | Mitigation |
|---|---|---|
| Large paste upload timeout | User experience kém, data loss | Client-side chunked upload, progress indicator, retry logic |
| S3 outage ảnh hưởng read path | Không serve được content | Redis cache L2 cho hot pastes, multi-region S3 replication |
| Content abuse (malware/spam paste) | Reputation risk, legal issues | Content scanning async job, report mechanism, rate limit anonymous |
| DB growth nhanh hơn dự kiến | Performance degradation | Partition strategy sẵn sàng, archive policy, monitor table size |
| Burn-after-read race condition | Multiple users đọc được content | `SELECT ... FOR UPDATE` lock, atomic DB update + S3 delete |

### Dependencies & Blockers
- Cần IAM/security baseline từ platform team trước khi lên production.
- Cần S3 bucket policy review và KMS key provisioning.
- Cần domain + TLS certificate + WAF policy approved.
- Cần Kafka topic provisioning và retention policy agreement với platform team.
- Cần budget approval cho MSK, ElastiCache, và S3 cross-region replication (nếu multi-region).
