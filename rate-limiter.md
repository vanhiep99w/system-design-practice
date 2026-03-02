# Rate Limiter - System Design

## 1. 📋 Đề Bài (Problem Statement)
- Thiết kế hệ thống **Rate Limiter** phân tán cho một nền tảng API lớn, cho phép kiểm soát số lượng request mà mỗi client (user, IP, API key) được gửi đến backend services trong một khoảng thời gian nhất định.
- Hệ thống phải xử lý hàng chục ngàn rate limit checks mỗi giây với latency cực thấp (<5ms), hỗ trợ nhiều thuật toán rate limiting, và đảm bảo high availability (fail-open nếu rate limiter gặp sự cố).
- **Scope chính** (in scope):
  - Rate limit enforcement (check + update counters) trên mỗi API request
  - Hỗ trợ nhiều thuật toán: Token Bucket, Sliding Window Counter, Fixed Window Counter
  - Rate limiting theo nhiều chiều: client_id, IP, API key, endpoint, hoặc combination
  - Rule management API (CRUD) với hot reload không cần restart
  - Rate limit response headers (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After)
  - Dashboard monitoring: top throttled clients, rule hit rates, violation trends
- **Scope ngoài bài** (out of scope): full DDoS protection (thuộc WAF/Shield), bot detection ML, billing/metering integration, request queuing/throttling (chỉ accept/reject).
- **Mục tiêu business**: bảo vệ backend services khỏi abuse và traffic spikes, đảm bảo fair usage giữa các clients, cung cấp SLA ổn định cho API platform.

## 2. 🔍 Requirement Gathering & Analysis

### 2.1 Functional Requirements
| Priority | Requirement | Mô tả |
|---|---|---|
| MUST-HAVE | Rate limit check | Kiểm tra request có vượt ngưỡng không, trả allowed/denied kèm metadata (remaining, reset time) |
| MUST-HAVE | Multiple algorithms | Hỗ trợ Token Bucket, Sliding Window Counter, Fixed Window Counter — configurable per rule |
| MUST-HAVE | Multi-dimension limiting | Rate limit theo client_id, IP, API key, endpoint pattern, hoặc combination |
| MUST-HAVE | Rule management API | CRUD cho rate limit rules với hot reload (broadcast qua Kafka, không cần restart) |
| MUST-HAVE | Rate limit headers | Trả X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After |
| MUST-HAVE | High availability | Fail-open nếu rate limiter down (cho phép request thay vì block tất cả) |
| NICE-TO-HAVE | Rate limit dashboard | UI hiển thị top throttled clients, rule hit rates, violation trends |
| NICE-TO-HAVE | Dynamic throttling | Tự động giảm limit khi backend health degraded (circuit breaker integration) |
| NICE-TO-HAVE | Multi-tier rules | Rule hierarchy: global → service → endpoint → plan → user (rule cụ thể hơn override rule chung) |
| NICE-TO-HAVE | Rate limit overrides | Cho phép override limit cho client cụ thể (VIP, partner) mà không cần đổi rule chung |

### 2.2 Non-Functional Requirements
- **Performance**: Rate limit check p99 < 5ms, p95 < 2ms (Redis round-trip). Rule evaluation (in-memory) < 0.1ms.
- **Scalability**: Xử lý peak ~29K rate limit checks/second (500M API calls/day × peak factor). Scale ngang bằng cách thêm Redis shards và application instances.
- **Availability**: 99.99% — nếu rate limiter down thì **fail-open** (allow all requests). Không được trở thành single point of failure cho toàn bộ platform.
- **Consistency**: Chấp nhận slight over-count trong race conditions (eventual consistency cho counters). Trong cửa sổ thời gian ngắn, client có thể gửi thêm 1-2 requests vượt limit — acceptable trade-off cho performance.
- **Security**: Rule management API yêu cầu admin auth. Rate limit data không chứa PII. Chống bypass bằng cách enforce ở Gateway layer.
- **Cost**: Ước lượng ~$1,500-2,500/tháng cho MVP (Redis cluster nhỏ, EKS pods, RDS cho rules). Scale lên full traffic ~$3,000-5,000/tháng.
- **Observability**: Metrics chi tiết per-rule (hit rate, rejection rate), per-client (top throttled), overall system health.

### 2.3 Capacity Estimation (Back-of-the-envelope)

#### Bước 0: Quy ước đơn vị
- `1 day = 86,400 seconds`
- `1M = 1,000,000`, `1B = 1,000,000,000`
- `1KB = 1,000B`, `1GB = 1,000,000,000B`

#### Bước 1: Inputs giả định
| Input | Giá trị | Tại sao chọn |
|---|---|---|
| Total API calls/day | 500M | Nền tảng API phục vụ 10 microservices, mỗi service ~50M calls/day |
| Rate limit checks per call | 1 | Mỗi request đi qua 1 lần check tại Gateway |
| Peak factor | x5 | Giờ cao điểm (flash sale, campaign launch) |
| Active rate limit rules | 5,000 | ~500 rules/service × 10 services |
| Unique clients active/day | 2M | API keys + IPs active trong ngày |
| Avg active time windows per client | 1 | Trung bình mỗi client active 1 endpoint tại 1 thời điểm |
| Counter entry size (Redis) | 200B | Key (~100B: prefix + client_id + endpoint + window) + value (~50B: counter/tokens + TTL) + Redis overhead (~50B) |
| Rule definition size | 500B | JSON: name, scope, pattern, limits, algorithm, metadata |
| Violation rate | ~1% | Ước tính 1% requests bị rate limited |

#### Bước 2: Tính rate limit check QPS
- Công thức: `check_qps_avg = total_api_calls / 86,400`
- Thay số: `500,000,000 / 86,400 = 5,787.04`
- Kết quả: **check QPS trung bình ~5,787**
- Peak factor `x5`: `5,787 * 5 = 28,935`
- Kết quả: **peak check QPS ~28,935**

#### Bước 3: Tính Redis operations/second
- Mỗi rate limit check cần trung bình **2 Redis operations** (1 GET counter + 1 SET/INCR counter, hoặc 1 Lua script atomic = 1 op nhưng nặng hơn ~2x simple op).
- Công thức: `redis_ops_avg = check_qps_avg * 2`
- Thay số: `5,787 * 2 = 11,574`
- Kết quả: **Redis ops trung bình ~11,574 ops/sec**
- Peak: `28,935 * 2 = 57,870`
- Kết quả: **peak Redis ops ~57,870 ops/sec**

> 📌 Một Redis node (ElastiCache r6g.large) hỗ trợ ~100K-200K ops/sec cho simple commands. Peak ~58K ops/sec nằm trong capacity 1 node, nhưng cần ít nhất 2 nodes cho HA.

#### Bước 4: Tính Redis memory cho counters
- Active counters tại bất kỳ thời điểm: `unique_clients * avg_windows_per_client`
- Thay số: `2,000,000 * 1 = 2,000,000 counters`
- Memory: `2,000,000 * 200B = 400,000,000B = 400MB`
- Cộng Redis overhead + fragmentation + replication (2.5x): `400MB * 2.5 = 1,000MB`
- Kết quả: **Redis cluster cần ~1GB** cho counters

#### Bước 5: Tính rule cache memory (in-memory)
- `5,000 rules * 500B = 2,500,000B = 2.5MB`
- Kết quả: **Rule cache ~2.5MB** — trivial, fit dễ dàng trong application memory

#### Bước 6: Tính violation data

> 📌 **Violation data là gì?** Mỗi khi một request bị rate limiter **từ chối** (trả 429 Too Many Requests), hệ thống ghi lại một bản ghi gọi là **violation**. Dữ liệu này dùng để: (1) hiển thị dashboard — top throttled clients, violation trends; (2) alert khi có client abuse bất thường; (3) audit trail cho security review. Violation ≠ mọi request, chỉ tính những request **bị reject vì vượt giới hạn**.

- Violation rate 1%: `500M * 1% = 5M violations/day`
- Mỗi violation log entry: ~300B (rule_id, client_id, timestamp, endpoint, metadata)
- Daily violation storage: `5M * 300B = 1.5GB/day`
- Yearly: `1.5GB * 365 = 547.5GB/year` (trước khi rollup/archive)

#### Bước 7: So sánh kịch bản
| Kịch bản | API calls/day | Check QPS avg | Peak QPS | Redis memory |
|---|---|---|---|---|
| Small platform | 100M | ~1,157 | ~5,787 | ~200MB |
| **Medium (đang dùng)** | **500M** | **~5,787** | **~28,935** | **~1GB** |
| Large platform | 2B | ~23,148 | ~115,741 | ~4GB |

> 📌 Rate limiter là lightweight service — bottleneck chính là Redis latency, không phải memory hay CPU. Với single Redis node hỗ trợ 100K+ ops/sec, hệ thống hiện tại comfortably fit trong 1 cluster nhỏ.

#### 📊 Bảng tổng hợp Capacity Estimation

| ID | Metric | Avg | Peak | Quyết định được drive bởi số liệu này |
|---|---|---|---|---|
| C1 | Rate limit check QPS | ~5,787 | **~28,935** | §3.2 Chọn embedded library (giảm hop) · §10 HPA rate-limit pods min=2, max=8 |
| C2 | Redis ops/sec | ~11,574 | **~57,870** | §3.3 Chọn Redis cluster (1 node đủ capacity) · §10 ElastiCache sizing |
| C3 | Active counters | **~2M** | — | §8 Redis key design · §3.3 Redis vs local memory |
| C4 | Redis memory | **~1GB** | — | §10 ElastiCache r6g.medium (13GB) — headroom lớn · §17 Cost |
| C5 | Violations/day | **~5M** | — | §8 violations table partition · §13 Alert thresholds |
| C6 | Rule definitions | **~5,000** | — | §3.4 PostgreSQL + in-memory cache · §8 rules table design |
| C7 | Rule cache memory | **~2.5MB** | — | §9 In-process cache, không cần external cache cho rules |

## 3. ⚖️ Trade-offs

### 3.1 Bảng tổng quan quyết định
| Decision | Option A | Option B | Option C | Chọn | Lý do chính |
|---|---|---|---|---|---|
| Rate limiting algorithm | Token Bucket | Sliding Window Counter | Fixed Window Counter | **A (default)** | Cho phép burst hợp lý, memory efficient, flexible |
| Architecture | Standalone gRPC service | **Embedded library + shared Redis** | — | B | Giảm 1 network hop, latency thấp hơn |
| Counter storage | **Redis (centralized)** | Local in-memory | — | A | Accurate across distributed instances |
| Rule storage | **PostgreSQL + in-memory cache** | Config file (YAML) | — | A | Dynamic rule changes không cần deploy |
| Failure behavior | Fail-closed (block all) | **Fail-open (allow all)** | — | B | Rate limiter không được là single point of failure |

### 3.2 Decision #1: Rate Limiting Algorithm (Token Bucket vs Sliding Window Counter vs Fixed Window Counter)

| Tiêu chí | Token Bucket | Sliding Window Counter | Fixed Window Counter |
|---|---|---|---|
| Burst handling | Cho phép burst (đến bucket size) | Smooth, ít burst | Có boundary burst problem |
| Memory per key | Thấp (2 fields: tokens, timestamp) | Trung bình (2 counters + weights) | Thấp (1 counter) |
| Accuracy | Approximate nhưng đủ tốt | Chính xác hơn | Chính xác trong window nhưng có edge case |
| Complexity | Trung bình | Trung bình | Đơn giản nhất |
| Use case phổ biến | API rate limiting, network throttling | Strict SLA enforcement | Simple counters |

#### Token Bucket hoạt động thế nào?

Mỗi client (hoặc client+endpoint combination) có một **bucket** chứa tokens:
1. Bucket có **capacity** (max tokens) và **refill rate** (tokens/sec).
2. Mỗi request tiêu thụ 1 token.
3. Tokens được refill liên tục theo thời gian (lazy evaluation — tính khi có request, không cần background job).
4. Nếu bucket rỗng → reject request.
5. Burst: nếu bucket đầy, client có thể gửi liên tiếp `capacity` requests rồi mới bị chặn.

**Ví dụ end-to-end (số thật)**:
- Rule: `max_tokens = 10, refill_rate = 2 tokens/sec` (tương đương 2 req/sec sustained, burst lên đến 10).
- Trạng thái ban đầu: `tokens = 10, last_refill = T0 = 1709110800.000` (Unix timestamp).

| Thời điểm | Event | Tính toán | tokens sau | Kết quả |
|---|---|---|---|---|
| T0 + 0.0s | Request 1 | elapsed=0s, refill=0, tokens=10-1=9 | 9 | ✅ ALLOW |
| T0 + 0.1s | Request 2 | elapsed=0.1s, refill=0.2, tokens=9+0.2-1=8.2 | 8.2 | ✅ ALLOW |
| T0 + 0.2s | Requests 3-9 (burst 7 requests) | elapsed=0.1s, refill=0.2, tokens=8.2+0.2-7=1.4 | 1.4 | ✅ ALLOW |
| T0 + 0.3s | Request 10 | elapsed=0.1s, refill=0.2, tokens=1.4+0.2-1=0.6 | 0.6 | ✅ ALLOW |
| T0 + 0.4s | Request 11 | elapsed=0.1s, refill=0.2, tokens=0.6+0.2=0.8, 0.8<1 → REJECT | 0.8 (giữ nguyên) | ❌ REJECT |
| T0 + 5.0s | Request 12 | elapsed=4.6s, refill=9.2, tokens=min(0.8+9.2, 10)-1=9 | 9 | ✅ ALLOW |

> 📌 Ưu điểm Token Bucket: cho phép burst hợp lý (client gửi 10 requests liên tiếp khi chưa dùng gì), sau đó rate giảm về sustained rate. Phù hợp API use case vì client thường gửi batch rồi im.

#### Fixed Window Counter hoạt động thế nào?

1. Chia thời gian thành các window cố định (ví dụ: mỗi 1 phút).
2. Mỗi window có 1 counter, mỗi request tăng counter lên 1.
3. Nếu counter ≥ limit → reject.
4. Khi sang window mới → counter reset về 0.

**Ví dụ**: Limit 100 req/phút.
- Window 10:00 - 10:01: counter = 0, requests come in → counter tăng dần.
- Đến counter = 100 → reject requests còn lại trong window.
- 10:01 → reset counter = 0.

**Boundary burst problem**: Nếu client gửi 100 requests cuối window 10:00-10:01 (lúc 10:00:59) và 100 requests đầu window 10:01-10:02 (lúc 10:01:00), trong 2 giây client gửi 200 requests — gấp đôi limit.

#### Sliding Window Counter hoạt động thế nào?

1. Kết hợp Fixed Window Counter của **window hiện tại** và **window trước**.
2. Tính weighted count: `count = prev_window_count * (1 - elapsed_fraction) + curr_window_count`.
3. So sánh weighted count với limit.

**Ví dụ**: Limit 100 req/phút, đang ở phút 10:01, đã trôi qua 15 giây (25% window).
- Previous window (10:00-10:01): count = 80.
- Current window (10:01-10:02): count = 30.
- Weighted: `80 * (1 - 0.25) + 30 = 60 + 30 = 90`.
- So với limit 100: còn 10 requests → ALLOW.
- Giải quyết được boundary burst problem nhưng vẫn là approximation.

#### Pseudo-code so sánh
```text
Token Bucket:
now = currentTime()
elapsed = now - bucket.lastRefill
bucket.tokens = min(bucket.tokens + elapsed * refillRate, maxTokens)
bucket.lastRefill = now
if bucket.tokens >= 1:
    bucket.tokens -= 1
    return ALLOW
return REJECT

Fixed Window Counter:
windowKey = floor(now / windowSize)
count = redis.incr(windowKey)
if count == 1: redis.expire(windowKey, windowSize)
if count > limit: return REJECT
return ALLOW

Sliding Window Counter:
currWindow = floor(now / windowSize)
prevWindow = currWindow - 1
elapsed = (now % windowSize) / windowSize
prevCount = redis.get(prevWindow) or 0
currCount = redis.incr(currWindow)
weighted = prevCount * (1 - elapsed) + currCount
if weighted > limit: return REJECT
return ALLOW
```

#### Kết luận cho bài toán này
- **Context**: Rate limiter cho API platform, cần cho phép burst hợp lý, memory efficient cho ~2M active counters `[C3]`.
- **Chọn Token Bucket** làm default algorithm vì:
  1. Cho phép burst tự nhiên — phù hợp API clients gửi batch requests.
  2. Memory thấp: chỉ cần 2 fields per key (tokens + last_refill).
  3. Được sử dụng rộng rãi (AWS API Gateway, Stripe, GitHub API đều dùng variant của Token Bucket).
- **Alternative**: Sliding Window Counter cho rules cần strict counting (ví dụ: SMS sending limit).
- **Mitigation cho Token Bucket burst**: set `max_tokens` thấp hơn nếu không muốn burst lớn (ví dụ: `max_tokens = rate_per_second * 2` thay vì `* 10`).

### 3.3 Decision #2: Architecture (Standalone Service vs Embedded Library)

| Tiêu chí | Standalone gRPC Service | Embedded Library + Shared Redis |
|---|---|---|
| Network latency | Thêm 1 hop (~1-3ms gRPC) | Không thêm hop, library gọi Redis trực tiếp |
| Deployment complexity | Cần deploy/manage thêm service | Nhúng vào mỗi service, version qua dependency |
| Consistency across services | Centralized logic, dễ ensure consistency | Mỗi service tự nhúng, phải sync version |
| Failure blast radius | Rate limiter down ảnh hưởng tất cả services | Mỗi service tự quản lý failure (fail-open local) |
| Resource isolation | Service riêng, scale riêng | Chia sẻ resources với host service |

#### Standalone gRPC Service hoạt động thế nào?
1. API Gateway/Service gửi gRPC call đến Rate Limiter Service trước khi xử lý business logic.
2. Rate Limiter Service check Redis, trả kết quả (allow/deny + metadata).
3. Gateway dựa vào kết quả để cho request qua hoặc trả 429.

**Nhược điểm**: thêm 1 network hop trên **mỗi** request. Với ~29K QPS peak `[C1]`, thêm 1-3ms/request tích lũy thành bottleneck. Rate limiter trở thành single point of failure — nếu nó chết, tất cả services bị ảnh hưởng.

#### Embedded Library hoạt động thế nào?
1. Rate limiter logic được đóng gói thành library (JAR/Maven dependency).
2. Mỗi service import library, gọi `rateLimiter.check(key, rule)` in-process.
3. Library nội bộ gọi Redis cluster để check/update counters.
4. Rules được cache in-memory, sync qua Kafka consumer (subscribe topic `rate-limit-rules`).

**Ưu điểm**: không thêm network hop (chỉ có Redis call vốn đã cần). Fail-open cục bộ — nếu Redis down, từng service tự fail-open, không có cascading failure.

#### Kết luận
- **Context**: Performance yêu cầu p99 < 5ms `[C1]`, thêm 1 hop gRPC có thể đẩy lên 6-8ms.
- **Chọn Embedded Library + Shared Redis** vì:
  1. Giảm latency bằng cách loại bỏ 1 network hop.
  2. Không có single point of failure riêng cho rate limiting.
  3. Library versioned qua Maven/Gradle, rollout qua normal dependency update.
- **Trade-off**: phải sync library version across services — mitigation: backwards-compatible API, semantic versioning.
- **Rule Service**: vẫn cần 1 standalone service nhỏ để quản lý rules (CRUD API + publish Kafka events). Nhưng service này không nằm trên critical path (chỉ admin operations).

### 3.4 Decision #3: Counter Storage (Redis vs Local In-Memory)

| Tiêu chí | Redis (Centralized) | Local In-Memory |
|---|---|---|
| Accuracy (distributed) | Chính xác — mọi instance share cùng counter | Mỗi instance count riêng, tổng có thể vượt limit |
| Latency | ~1-2ms per Redis call | ~0.01ms (in-process) |
| Failure mode | Redis down → mất counters | Process restart → mất counters |
| Scalability | Redis cluster auto-shard | Mỗi instance giới hạn bởi RAM |

#### Redis (centralized) hoạt động thế nào?
1. Mọi pod dùng cùng một key-space trong Redis cho cùng `client + endpoint`.
2. Mỗi request chạy Lua script atomic để read-update-write counter/token.
3. Kết quả allow/reject nhất quán giữa các pods vì cùng đọc/ghi một nguồn dữ liệu.
4. Key tự hết hạn theo TTL nên không cần cleanup batch job.

#### Local In-Memory hoạt động thế nào?
1. Mỗi pod giữ counter riêng trong RAM (ConcurrentHashMap/Caffeine).
2. Request vào pod nào thì tăng counter pod đó.
3. Không có synchronization cross-pod, nên tổng request toàn cụm thường vượt global limit.
4. Pod restart hoặc scale events làm counter reset/chia lại không đồng nhất.

#### Vì sao inaccuracy của Local In-Memory là vấn đề?
- Giả sử service có 10 pods, limit = 100 req/min.
- Mỗi pod chỉ biết local counter → mỗi pod cho phép 100 req → tổng = 1,000 req/min (10× limit).
- Có thể chia limit: `100 / 10 = 10 req/min/pod`, nhưng:
  - Nếu traffic không đều giữa pods → một số pod reject sớm, một số chưa dùng hết.
  - Pod count thay đổi khi HPA scale → limit per pod phải recalculate.

```java
// Redis centralized (được chọn)
RateLimitResult result = redisLimiter.check("api-key-123:/products", rule);

// Local in-memory (không chọn cho distributed accuracy)
AtomicInteger counter = localMap.computeIfAbsent(key, k -> new AtomicInteger(0));
boolean allowed = counter.incrementAndGet() <= limit;
```

#### Kết luận
- **Chọn Redis** vì cần accuracy across distributed instances. Với ~2M active counters `[C3]` chỉ tốn ~1GB Redis memory `[C4]` — rất nhẹ.
- **L1 local cache optimization** (optional): cache Redis response in-memory 100-500ms cho cùng key. Giảm Redis calls cho hot keys (viral endpoints), chấp nhận slight over-count trong window 500ms.
- **Mitigation khi Redis down**: fail-open + switch sang local in-memory counting tạm thời (degrade accuracy nhưng vẫn có basic protection).

### 3.5 Decision #4: Rule Storage (PostgreSQL + Cache vs Config File)

| Tiêu chí | PostgreSQL + In-Memory Cache | Config File (YAML) |
|---|---|---|
| Dynamic changes | Thay đổi ngay qua API, broadcast Kafka | Cần commit, deploy lại tất cả services |
| Audit trail | DB có history, dễ track who changed what | Git history |
| Complexity | Cần Rule Service + Kafka sync | Đơn giản, file-based |
| Reliability | DB dependency | Không dependency ngoài |

#### PostgreSQL + cache hoạt động thế nào?
1. Admin gọi Rule Service để CRUD rule/override.
2. Rule Service ghi PostgreSQL (source of truth), commit transaction.
3. Sau commit publish `RuleChangedEvent` lên Kafka.
4. Các pods cập nhật in-memory cache từ event trong vài giây.

#### Config file hoạt động thế nào?
1. Rule nằm trong YAML trong repo.
2. Muốn đổi rule phải sửa file, tạo PR, merge, chạy CI/CD.
3. Tất cả services phải rollout bản mới để nhận rule cập nhật.
4. Không phù hợp cho thay đổi nóng (incident response/partner override).

```yaml
# Config file approach (không chọn)
rules:
  - name: free-plan-products-api
    endpointPattern: /api/v1/products/**
    algorithm: TOKEN_BUCKET
    maxRequests: 100
    windowSeconds: 60
```

#### Kết luận
- **Chọn PostgreSQL + In-Memory Cache** vì:
  1. Rules cần thay đổi real-time (ví dụ: tăng limit cho partner API key ngay lập tức, không đợi deploy).
  2. Với ~5,000 rules `[C6]`, cache chỉ tốn ~2.5MB `[C7]` — trivial.
  3. Audit trail quan trọng cho security compliance.
- **Sync mechanism**: Rule Service publish event `RuleChangedEvent` vào Kafka topic `rate-limit-rules`. Tất cả service instances (nhúng library) subscribe topic, update in-memory cache.
- **Startup**: service boot → load toàn bộ rules từ Rule Service API → cache in-memory → subscribe Kafka cho incremental updates.

### 3.6 Decision #5: Failure Behavior (Fail-Open vs Fail-Closed)

| Tiêu chí | Fail-Closed (block all) | Fail-Open (allow all) |
|---|---|---|
| Security | An toàn hơn — không ai qua khi system lỗi | Rủi ro abuse khi rate limiter down |
| Availability | Tất cả API down nếu rate limiter down | API vẫn hoạt động, chỉ mất rate limiting |
| Business impact | Revenue loss (block legitimate users) | Potential abuse nhưng API vẫn serve |

**Ví dụ với số thật**:
- Peak traffic: `~28,935 req/s` `[C1]`.
- Nếu fail-closed trong 10 phút incident Redis:
  - Request bị block: `28,935 × 600 = 17,361,000 requests`.
  - Ảnh hưởng trực tiếp availability của toàn platform.
- Nếu fail-open:
  - API vẫn phục vụ traffic hợp lệ.
  - Rủi ro abuse được giảm bớt bởi WAF + backend capacity guardrails.

```text
if redisAvailable():
  return enforceRateLimit()
if mode == FAIL_CLOSED:
  return REJECT(429)
return ALLOW  // FAIL_OPEN
```

#### Kết luận
- **Chọn Fail-Open** vì rate limiter **không được** trở thành single point of failure.
- Business impact khi block tất cả users (false negative) lớn hơn rủi ro bị abuse tạm thời.
- **Mitigation**: khi fail-open, emit high-priority alert → ops team investigate Redis/network issue. WAF vẫn bảo vệ chống DDoS cực đoan.
- Backend services vẫn có riêng capacity limits (connection pool, thread pool) làm safety net cuối cùng.

## 4. 🧩 Defining Entities / Components

### Component Diagram

```mermaid
flowchart TB
    subgraph Edge["Edge Layer"]
        WAF[AWS WAF]
        CDN[CloudFront]
    end

    subgraph Application["Application Layer (EKS)"]
        GW[API Gateway + Rate Limit Library]
        SVC1[Service A + Rate Limit Library]
        SVC2[Service B + Rate Limit Library]
        RULESVC[Rule Management Service]
        DASHBOARD[Dashboard Service]
    end

    subgraph Data["Data Layer"]
        REDIS[(Redis Cluster\nCounters)]
        DB[(PostgreSQL\nRules + Violations)]
    end

    subgraph Async["Async Layer"]
        KAFKA[Kafka]
    end

    subgraph Observability["Observability"]
        PROM[Prometheus]
        GRAFANA[Grafana]
    end

    CDN --> WAF --> GW
    GW --> SVC1
    GW --> SVC2
    GW --> REDIS
    SVC1 --> REDIS
    SVC2 --> REDIS
    RULESVC --> DB
    RULESVC --> KAFKA
    KAFKA --> GW
    KAFKA --> SVC1
    KAFKA --> SVC2
    DASHBOARD --> DB
    DASHBOARD --> REDIS

    GW -.metrics.-> PROM
    SVC1 -.metrics.-> PROM
    PROM -.-> GRAFANA
```

### Bảng vai trò từng component

| Component | Vai trò |
|---|---|
| AWS WAF | DDoS protection cơ bản, IP blocklist — tuyến phòng thủ đầu tiên |
| API Gateway + Rate Limit Library | Nhúng rate limit library, check mỗi request trước khi forward |
| Service A/B + Rate Limit Library | Mỗi service nhúng library, có thể apply service-specific rules |
| Rate Limit Library | Core logic: rule evaluation, Redis counter operations, fail-open, metrics |
| Rule Management Service | REST API quản lý rules (CRUD), publish events qua Kafka |
| Dashboard Service | UI hiển thị metrics, top throttled clients, rule management |
| Redis Cluster | Lưu rate limit counters (Token Bucket state, window counters) |
| PostgreSQL | Source of truth cho rules, overrides, violation logs |
| Kafka | Broadcast rule change events đến tất cả service instances |
| Prometheus + Grafana | Metrics collection và visualization |

> 💡 **Tại sao nhúng library thay vì proxy/sidecar?**
> Sidecar pattern (Envoy rate limiting) thêm latency tương tự standalone service (~1ms intra-pod). Embedded library gọi Redis trực tiếp từ application process, latency chỉ phụ thuộc Redis round-trip (~1-2ms). Với yêu cầu p99 < 5ms, mỗi millisecond đều quan trọng.

## 5. 🔗 Client-Server Connection

- **Protocol**:
  - REST (HTTPS) cho Rule Management API (`/api/v1/rules/...`) — admin operations, infrequent.
  - In-process method call cho rate limit check (library embedded, không qua network).
  - Redis protocol (RESP) cho counter operations — binary, low overhead.
  - Kafka protocol cho rule sync — async, pub-sub.

- **Authentication**:
  - Rule Management API: JWT Bearer token + RBAC (chỉ admin/platform-ops được CRUD rules).
  - Dashboard: JWT + read-only role cho monitoring, write role cho rule management.
  - Rate limit check: không cần auth riêng (library chạy in-process, trust host service).

- **Connection patterns**:
  - Request-Response: REST cho rule management, Redis cho counter operations.
  - Pub-Sub: Kafka cho rule change broadcasts.
  - Fire-and-forget: violation logging (async, không block request path).

- **Rate limit response headers** (trả từ Gateway cho client):
  ```
  X-RateLimit-Limit: 100          # Max requests allowed in window
  X-RateLimit-Remaining: 42       # Requests remaining
  X-RateLimit-Reset: 1709111460   # Unix timestamp when window resets
  Retry-After: 30                 # Seconds until client should retry (only on 429)
  ```

- **Idempotency**:
  - Rate limit check **không idempotent theo business semantics**: cùng request gọi lại sẽ tiếp tục tiêu thụ token/counter.
  - Rule CRUD hỗ trợ `Idempotency-Key` cho create/update operations để tránh tạo duplicate rule khi admin client retry.

- **Rate limiting & throttling cho Rule Management API**:
  | Role | Endpoint group | Limit | Algorithm |
  |---|---|---|---|
  | `rate-limit-admin` | CRUD rules (`POST/PUT/DELETE /api/v1/rules`) | 100 req/min | Token Bucket |
  | `rate-limit-admin` | Read rules (`GET /api/v1/rules`) | 500 req/min | Token Bucket |
  | `rate-limit-viewer` | Dashboard read-only (`GET /api/v1/metrics`, `GET /api/v1/violations`) | 1,000 req/min | Sliding Window |
  | Anonymous | Tất cả endpoints | Blocked (401) | — |

  > 📌 Rule Management API bản thân cũng cần rate limit để tránh admin script chạy sai gây overload DB/Kafka. Limits này enforce tại API Gateway layer, dùng chính rate-limit-library.

## 6. 🔄 System / App Flow

### Flow 1: Rate Limit Check (Critical Path)

```mermaid
sequenceDiagram
    participant C as Client
    participant GW as API Gateway
    participant RL as Rate Limit Library
    participant R as Redis
    participant K as Kafka
    participant SVC as Backend Service

    C->>GW: GET /api/v1/products
    GW->>RL: check(clientId="api-key-123", endpoint="/products", method="GET")

    RL->>RL: Evaluate rules (in-memory cache)\nMatch rule: "free-plan-products" (Token Bucket: 100 req/min)

    RL->>R: EVALSHA <sha1>\nKEY=rl:api-key-123:/products\nARGS=max_tokens=100, refill_rate=1.67/sec, now=0(use Redis TIME)
    Note right of R: EVALSHA dùng SHA1 hash của Lua script đã pre-load (SCRIPT LOAD)

    alt Tokens available
        R-->>RL: [1, 57, 1709111460]\n(allowed=1, remaining=57, reset_ts)
        RL-->>GW: ALLOW {remaining=57, limit=100, reset=1709111460}
        GW->>SVC: Forward request
        SVC-->>GW: 200 OK {products}
        GW-->>C: 200 OK\nX-RateLimit-Limit: 100\nX-RateLimit-Remaining: 57\nX-RateLimit-Reset: 1709111460
    else Bucket empty
        R-->>RL: [0, 0, 1709111460]\n(allowed=0, remaining=0, reset_ts)
        RL-->>GW: REJECT {remaining=0, limit=100, reset=1709111460, retryAfter=23}
        RL->>K: Publish ViolationEvent (async, fire-and-forget)
        GW-->>C: 429 Too Many Requests\nX-RateLimit-Limit: 100\nX-RateLimit-Remaining: 0\nRetry-After: 23
    end
```

### Flow 2: Rule Management (Admin Path)

```mermaid
sequenceDiagram
    actor A as Admin
    participant RS as Rule Service
    participant DB as PostgreSQL
    participant K as Kafka
    participant GW1 as Gateway Pod 1
    participant GW2 as Gateway Pod 2

    A->>RS: POST /api/v1/rules {name, scope, limits...}
    RS->>RS: Validate rule definition
    RS->>DB: INSERT INTO rate_limit_rules (...)
    DB-->>RS: Created (id=42)

    RS->>K: Publish RuleChangedEvent\n{type: "CREATED", ruleId: 42, payload: {...}}
    RS-->>A: 201 Created {rule}

    par Broadcast to all instances
        K-->>GW1: RuleChangedEvent
        GW1->>GW1: Update in-memory rule cache
    and
        K-->>GW2: RuleChangedEvent
        GW2->>GW2: Update in-memory rule cache
    end

    Note over GW1,GW2: New rule active within seconds
```

### Flow 3: Token Bucket — Redis Lua Script (Atomic Operation)

```mermaid
sequenceDiagram
    participant RL as Rate Limit Library
    participant R as Redis

    RL->>R: EVALSHA <sha1>\nKEYS[1] = "rl:client123:/api/products"\nARGV = [max_tokens=10, refill_rate=2, now=0(use Redis TIME)]
    Note right of R: EVALSHA dùng SHA1 hash của Lua script đã pre-load (SCRIPT LOAD)

    Note over R: Lua Script (atomic):
    Note over R: 1. GET key → {tokens: 3.2, last: 1709110800.000}
    Note over R: 2. now = redis.TIME(), elapsed = now - last, refill = elapsed * 2
    Note over R: 3. tokens = min(3.2 + 1.0, 10) = 4.2
    Note over R: 4. tokens >= 1 → tokens = 3.2, allowed = true
    Note over R: 5. SET key {tokens: 3.2, last: 1709110800.500}
    Note over R: 6. EXPIRE key TTL = max_tokens / refill_rate + buffer

    R-->>RL: [1, 3, 1709110805]\n(allowed, remaining_floor, reset_ts)
```

### Error handling & Edge cases
| Error case | HTTP Status / Internal Code | Behavior |
|---|---|---|
| Redis timeout (>5ms) | 200/4xx passthrough + `RL_FAIL_OPEN` | Fail-open: allow request, increment local counter, emit alert metric |
| Redis connection lost | 200/4xx passthrough + `RL_CIRCUIT_OPEN` | Circuit breaker opens → fail-open for 30s → half-open retry |
| No matching rule for request | 200/4xx passthrough + `RL_NO_MATCH` | Allow request (no rule = no limit). Log warning for visibility |
| Rule cache empty (startup race) | 503 Service Unavailable (readiness fail) | Block startup until initial rule load completes (readiness probe fails until cache warm) |
| Clock skew between pods | N/A (design constraint) | Token Bucket dùng Redis server time (`redis.call('TIME')`), không dùng client time |
| Counter overflow | N/A (unlikely) | Redis INCR trên 64-bit integer, overflow không xảy ra trong thực tế |
| Lua script not loaded | 200/4xx passthrough + `RL_NOSCRIPT_RELOAD` | Auto-reload script via `SCRIPT LOAD` on `NOSCRIPT` error, retry 1 lần |

## 7. 📡 API Modeling

### Endpoint Definitions (Rule Management Service)
| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/api/v1/rules` | Admin JWT | Tạo rate limit rule mới |
| GET | `/api/v1/rules` | Admin JWT | Liệt kê rules (filter, paginate) |
| GET | `/api/v1/rules/{id}` | Admin JWT | Lấy chi tiết 1 rule |
| PUT | `/api/v1/rules/{id}` | Admin JWT | Cập nhật rule (publish change event) |
| DELETE | `/api/v1/rules/{id}` | Admin JWT | Xóa rule (soft delete + publish event) |
| POST | `/api/v1/rules/{id}/overrides` | Admin JWT | Tạo override cho client cụ thể |
| GET | `/api/v1/metrics/top-throttled` | Read JWT | Top throttled clients |
| GET | `/api/v1/metrics/rules/{id}/stats` | Read JWT | Hit rate, rejection rate cho 1 rule |

### Internal API (Rate Limit Library — in-process)
```java
public interface RateLimiter {
    /**
     * Check if request is allowed under rate limiting rules.
     * @param context contains clientId, ip, apiKey, endpoint, method
     * @return RateLimitResult with allowed, remaining, limit, resetAt, retryAfterSec
     */
    RateLimitResult check(RateLimitContext context);
}
```

### Request/Response Examples

**Create Rule**
```http
POST /api/v1/rules HTTP/1.1
Host: api.ratelimiter.internal
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Idempotency-Key: 7a3f9e28-4c1d-4b5a-8e7f-123456789abc

{
  "name": "free-plan-products-api",
  "description": "Rate limit for free plan users on products endpoint",
  "scope": "PER_API_KEY",
  "endpointPattern": "/api/v1/products/**",
  "method": "GET",
  "algorithm": "TOKEN_BUCKET",
  "maxRequests": 100,
  "windowSeconds": 60,
  "burstSize": 20,
  "plan": "free",
  "enabled": true,
  "priority": 10
}
```

```http
HTTP/1.1 201 Created
Content-Type: application/json
Location: /api/v1/rules/42

{
  "id": 42,
  "name": "free-plan-products-api",
  "description": "Rate limit for free plan users on products endpoint",
  "scope": "PER_API_KEY",
  "endpointPattern": "/api/v1/products/**",
  "method": "GET",
  "algorithm": "TOKEN_BUCKET",
  "maxRequests": 100,
  "windowSeconds": 60,
  "burstSize": 20,
  "plan": "free",
  "enabled": true,
  "priority": 10,
  "createdAt": "2026-03-01T10:00:00Z",
  "updatedAt": "2026-03-01T10:00:00Z",
  "createdBy": "admin@platform.com"
}
```

**Create Override for VIP Client**
```http
POST /api/v1/rules/42/overrides HTTP/1.1
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...

{
  "clientId": "api-key-partner-xyz",
  "maxRequests": 500,
  "windowSeconds": 60,
  "burstSize": 100,
  "reason": "Partner agreement — higher limit",
  "expireAt": "2027-01-01T00:00:00Z"
}
```

```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "id": 7,
  "ruleId": 42,
  "clientId": "api-key-partner-xyz",
  "maxRequests": 500,
  "windowSeconds": 60,
  "burstSize": 100,
  "reason": "Partner agreement — higher limit",
  "expireAt": "2027-01-01T00:00:00Z",
  "createdAt": "2026-03-01T10:30:00Z",
  "createdBy": "admin@platform.com"
}
```

**Rate Limited Response (trả từ Gateway cho client)**
```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1709111460
Retry-After: 23

{
  "timestamp": "2026-03-01T10:30:37Z",
  "status": 429,
  "error": "Too Many Requests",
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Rate limit exceeded. Try again in 23 seconds.",
  "path": "/api/v1/products"
}
```

### Error Response Format
```json
{
  "timestamp": "2026-03-01T10:31:00Z",
  "status": 400,
  "error": "Bad Request",
  "code": "INVALID_RULE_DEFINITION",
  "message": "windowSeconds must be between 1 and 86400",
  "path": "/api/v1/rules"
}
```

### Pagination / Filtering / Sorting
- **Strategy**: Cursor-based pagination cho rules list (cursor = `id`).
- **Filter fields**: `scope`, `algorithm`, `plan`, `enabled`, `endpointPattern`.
- **Sort**: `priority ASC` (mặc định), `createdAt DESC`, `name ASC`.
- **Page size**: default 20, max 100.
- Ví dụ: `GET /api/v1/rules?scope=PER_API_KEY&plan=free&cursor=42&limit=20`

### API Versioning
- Strategy: path-based (`/api/v1/...`).
- Deprecation policy: dual-run ít nhất 6 tháng, gửi `Deprecation` header trên v1 khi v2 sẵn sàng.

## 8. 🗄️ Data Modeling

### Database Schema (PostgreSQL — Rule Management)

```sql
CREATE TABLE rate_limit_rules (
    id              BIGSERIAL       PRIMARY KEY,
    name            VARCHAR(100)    NOT NULL UNIQUE,
    description     VARCHAR(500),
    scope           VARCHAR(20)     NOT NULL
                                    CHECK (scope IN ('GLOBAL', 'PER_IP', 'PER_API_KEY', 'PER_USER', 'PER_ENDPOINT')),
    endpoint_pattern VARCHAR(255),
    method          VARCHAR(10)     CHECK (method IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH', '*')),
    algorithm       VARCHAR(30)     NOT NULL DEFAULT 'TOKEN_BUCKET'
                                    CHECK (algorithm IN ('TOKEN_BUCKET', 'SLIDING_WINDOW', 'FIXED_WINDOW')),
    max_requests    INTEGER         NOT NULL CHECK (max_requests > 0),
    window_seconds  INTEGER         NOT NULL CHECK (window_seconds BETWEEN 1 AND 86400),
    burst_size      INTEGER         CHECK (burst_size > 0),
    plan            VARCHAR(30),
    priority        INTEGER         NOT NULL DEFAULT 0,
    enabled         BOOLEAN         NOT NULL DEFAULT TRUE,
    created_by      VARCHAR(255)    NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE rate_limit_overrides (
    id              BIGSERIAL       PRIMARY KEY,
    rule_id         BIGINT          NOT NULL REFERENCES rate_limit_rules(id) ON DELETE CASCADE,
    client_id       VARCHAR(255)    NOT NULL,
    max_requests    INTEGER         NOT NULL CHECK (max_requests > 0),
    window_seconds  INTEGER         NOT NULL CHECK (window_seconds BETWEEN 1 AND 86400),
    burst_size      INTEGER,
    reason          VARCHAR(500)    NOT NULL,
    expire_at       TIMESTAMPTZ,
    created_by      VARCHAR(255)    NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (rule_id, client_id)
);

CREATE TABLE rate_limit_violations_daily (
    rule_id         BIGINT          NOT NULL,
    client_id       VARCHAR(255)    NOT NULL,
    violation_date  DATE            NOT NULL,
    violation_count INTEGER         NOT NULL DEFAULT 0,
    first_violated_at TIMESTAMPTZ   NOT NULL,
    last_violated_at  TIMESTAMPTZ   NOT NULL,
    PRIMARY KEY (rule_id, client_id, violation_date)
);
```

### Redis Data Structures

#### Token Bucket (1 Hash per client+endpoint)
```
Key:    rl:tb:{clientId}:{endpointHash}
Type:   Hash
Fields: tokens (float), last_refill (unix timestamp float)
TTL:    max_tokens / refill_rate * 2 (auto-expire inactive buckets)

Example:
  Key:    rl:tb:api-key-123:a1b2c3
  Value:  { "tokens": "7.4", "last_refill": "1709110800.500" }
  TTL:    12s (max_tokens=10, refill_rate=1.67 → 10/1.67≈6s × 2 ≈ 12s)
```

#### Sliding Window Counter (2 Strings per client+endpoint)
```
Key:    rl:sw:{clientId}:{endpointHash}:{windowTimestamp}
Type:   String (integer counter)
TTL:    window_seconds * 2

Example (window = 60s, current window = 1709110800):
  Key:    rl:sw:api-key-123:a1b2c3:1709110800
  Value:  "42"
  TTL:    120s

  Key:    rl:sw:api-key-123:a1b2c3:1709110740  (previous window)
  Value:  "87"
  TTL:    60s (sắp expire)
```

#### Fixed Window Counter (1 String per client+endpoint+window)
```
Key:    rl:fw:{clientId}:{endpointHash}:{windowTimestamp}
Type:   String (integer counter)
TTL:    window_seconds

Example:
  Key:    rl:fw:api-key-123:a1b2c3:1709110800
  Value:  "55"
  TTL:    60s
```

> 💡 **Tại sao dùng Hash cho Token Bucket mà String cho Window Counters?**
> Token Bucket cần lưu 2 fields (tokens + last_refill) atomically → Hash phù hợp. Window counters chỉ cần 1 integer → String + INCR đơn giản và nhanh hơn. Cả hai đều wrap trong Lua script để đảm bảo atomicity.

### ER Diagram

```mermaid
erDiagram
    RATE_LIMIT_RULES {
        bigserial id PK
        varchar name UK
        varchar description
        varchar scope
        varchar endpoint_pattern
        varchar method
        varchar algorithm
        integer max_requests
        integer window_seconds
        integer burst_size
        varchar plan
        integer priority
        boolean enabled
        varchar created_by
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at
    }

    RATE_LIMIT_OVERRIDES {
        bigserial id PK
        bigint rule_id FK
        varchar client_id
        integer max_requests
        integer window_seconds
        integer burst_size
        varchar reason
        timestamptz expire_at
        varchar created_by
        timestamptz created_at
    }

    RATE_LIMIT_VIOLATIONS_DAILY {
        bigint rule_id PK,FK
        varchar client_id PK
        date violation_date PK
        integer violation_count
        timestamptz first_violated_at
        timestamptz last_violated_at
    }

    RATE_LIMIT_RULES ||--o{ RATE_LIMIT_OVERRIDES : "has overrides"
    RATE_LIMIT_RULES ||--o{ RATE_LIMIT_VIOLATIONS_DAILY : "has violations"
```

### Indexing Strategy
| Index | Columns | Loại | Phục vụ query |
|---|---|---|---|
| `idx_rules_name` | `name` | UNIQUE | Lookup rule by name |
| `idx_rules_scope_plan` | `scope, plan` | Composite | Filter rules by scope + plan |
| `idx_rules_enabled` | `enabled` | Partial (`WHERE enabled = true AND deleted_at IS NULL`) | Load active rules only |
| `idx_rules_endpoint` | `endpoint_pattern` | B-tree | Match rules by endpoint |
| `idx_rules_deleted` | `deleted_at` | Partial (`WHERE deleted_at IS NOT NULL`) | Cleanup soft-deleted rules sau 90 ngày |
| `idx_overrides_rule_client` | `rule_id, client_id` | UNIQUE | Lookup override for specific client |
| `idx_overrides_expire` | `expire_at` | B-tree, partial (`WHERE expire_at IS NOT NULL`) | Cleanup expired overrides |
| `idx_violations_date` | `violation_date` | B-tree | Cleanup old violations, daily reports |
| `idx_violations_rule_date` | `rule_id, violation_date DESC` | Composite | Rule-specific violation history |

### Partitioning / Sharding Strategy
- **rate_limit_rules**: Không cần partition (~5,000 rows `[C6]`, trivial size).
- **rate_limit_overrides**: Không cần partition (small table, thousands of rows).
- **rate_limit_violations_daily**: Range partition theo `violation_date` (monthly partitions).
  - 5M violations/day `[C5]` → ~150M rows/month → partition giúp `DROP PARTITION` nhanh khi retention hết.
  - Query violation history chỉ cần scan 1-2 partitions thay vì full table.

### Data Retention Policy
| Loại data | Retention | Strategy |
|---|---|---|
| Rate limit rules | Vĩnh viễn (soft delete) | Soft delete (`deleted_at = NOW()`), hard delete sau 90 ngày. `enabled = false` chỉ tạm vô hiệu hóa rule, không xóa |
| Overrides | Theo `expire_at` + 30 ngày | Cleanup job xóa expired overrides |
| Violations daily | 90 ngày detail | Drop monthly partition sau 90 ngày. Rollup → monthly aggregate trước khi drop |
| Redis counters | Auto-expire theo TTL | Token Bucket: TTL = `max_tokens / refill_rate * 2`. Window counters: TTL = `window_seconds * 2`. Redis tự cleanup |

> 💡 **Redis counter TTL strategy**: Token Bucket key có TTL = `max_tokens / refill_rate * 2` (đủ thời gian refill full bucket × 2 làm buffer). Ví dụ: max_tokens=10, refill_rate=1.67/s → TTL = 10/1.67 × 2 ≈ 12s. Window counters dùng TTL = `window_seconds * 2` (ví dụ 60s → 120s). Đảm bảo counter tồn tại đủ lâu cho sliding window tính toán, nhưng tự cleanup khi client inactive.

## 9. ⚙️ Manager Classes / Services

### Service Decomposition
| Service | Vai trò |
|---|---|
| `rate-limit-library` | Core library nhúng vào mỗi service: rule evaluation, Redis operations, fail-open, metrics export |
| `rule-service` | REST API quản lý rules + overrides, publish change events qua Kafka |
| `violation-aggregator` | Consume violation events từ Kafka, batch upsert vào `rate_limit_violations_daily` |
| `dashboard-service` | BFF cho Dashboard UI, query violations + metrics từ DB + Prometheus |

### Core Service Classes & Responsibilities
- `TokenBucketLimiter` (`@Component`): implement Token Bucket algorithm, gọi Redis Lua script.
- `SlidingWindowLimiter` (`@Component`): implement Sliding Window Counter algorithm.
- `FixedWindowLimiter` (`@Component`): implement Fixed Window Counter algorithm.
- `RateLimiterFactory` (`@Component`): factory tạo limiter instance theo algorithm config.
- `RuleEvaluator` (`@Component`): match incoming request với rules (in-memory), resolve overrides.
- `RuleCacheManager` (`@Component`): quản lý in-memory rule cache, subscribe Kafka updates.
- `RedisCounterClient` (`@Component`): abstract Redis operations (Lua script execution, connection management).
- `RateLimitRuleService` (`@Service`): CRUD logic cho rules, validation, publish Kafka events.
- `ViolationEventPublisher` (`@Component`): publish violation events async (fire-and-forget).

### Backend Code Example — Rate Limit Library (Java / Spring Boot)

```java
@Component
public class TokenBucketLimiter implements RateLimitAlgorithm {

    private final RedisCounterClient redisClient;

    public TokenBucketLimiter(RedisCounterClient redisClient) {
        this.redisClient = redisClient;
    }

    @Override
    public RateLimitResult check(String key, RateLimitRule rule) {
        double maxTokens = rule.getBurstSize() != null
                ? rule.getBurstSize()
                : rule.getMaxRequests();
        double refillRate = (double) rule.getMaxRequests() / rule.getWindowSeconds();

        // Pass 0 so Lua script uses Redis server time (TIME) to avoid pod clock skew
        List<Object> result = redisClient.evalTokenBucket(
                "rl:tb:" + key,
                maxTokens,
                refillRate,
                0,
                (long)(maxTokens / refillRate * 2)  // TTL: thời gian refill full bucket × 2
        );

        boolean allowed = ((Long) result.get(0)) == 1L;
        long remaining = (Long) result.get(1);
        long resetAt = (Long) result.get(2);

        return RateLimitResult.builder()
                .allowed(allowed)
                .remaining(remaining)
                .limit(rule.getMaxRequests())
                .resetAt(Instant.ofEpochSecond(resetAt))
                .retryAfterSeconds(allowed
                        ? 0
                        : Math.max(0, (int) (resetAt - Instant.now().getEpochSecond())))
                .build();
    }
}
```

```java
@Component
public class RuleEvaluator {

    private final RuleCacheManager ruleCache;
    private final PathMatcher pathMatcher = new AntPathMatcher();

    public RuleEvaluator(RuleCacheManager ruleCache) {
        this.ruleCache = ruleCache;
    }

    public Optional<ResolvedRule> evaluate(RateLimitContext ctx) {
        List<RateLimitRule> matchingRules = ruleCache.getActiveRules().stream()
                .filter(rule -> matches(rule, ctx))
                .sorted(Comparator.comparingInt(RateLimitRule::getPriority).reversed())
                .toList();

        if (matchingRules.isEmpty()) {
            return Optional.empty();
        }

        RateLimitRule bestMatch = matchingRules.get(0);

        // Check for client-specific override
        Optional<RateLimitOverride> override = ruleCache.getOverride(bestMatch.getId(), ctx.clientId());
        if (override.isPresent() && !override.get().isExpired()) {
            return Optional.of(ResolvedRule.fromOverride(bestMatch, override.get()));
        }

        return Optional.of(ResolvedRule.from(bestMatch));
    }

    private boolean matches(RateLimitRule rule, RateLimitContext ctx) {
        if (!rule.isEnabled()) return false;
        if (rule.getMethod() != null && !"*".equals(rule.getMethod())
                && !rule.getMethod().equals(ctx.method())) return false;
        if (rule.getEndpointPattern() != null
                && !pathMatcher.match(rule.getEndpointPattern(), ctx.endpoint())) return false;
        if (rule.getPlan() != null && !rule.getPlan().equals(ctx.plan())) return false;
        return true;
    }
}
```

```java
@Component
public class DistributedRateLimiter implements RateLimiter {

    private final RuleEvaluator ruleEvaluator;
    private final RateLimiterFactory limiterFactory;
    private final ViolationEventPublisher violationPublisher;
    private final MeterRegistry meterRegistry;

    public DistributedRateLimiter(RuleEvaluator ruleEvaluator,
                                   RateLimiterFactory limiterFactory,
                                   ViolationEventPublisher violationPublisher,
                                   MeterRegistry meterRegistry) {
        this.ruleEvaluator = ruleEvaluator;
        this.limiterFactory = limiterFactory;
        this.violationPublisher = violationPublisher;
        this.meterRegistry = meterRegistry;
    }

    @Override
    public RateLimitResult check(RateLimitContext context) {
        try {
            Optional<ResolvedRule> resolvedRule = ruleEvaluator.evaluate(context);
            if (resolvedRule.isEmpty()) {
                return RateLimitResult.allowed();  // No rule = no limit
            }

            ResolvedRule rule = resolvedRule.get();
            String key = buildKey(context, rule);
            RateLimitAlgorithm algorithm = limiterFactory.get(rule.getAlgorithm());
            RateLimitResult result = algorithm.check(key, rule.toRule());

            meterRegistry.counter("rate_limit_checks",
                    "rule", rule.getName(), "result", result.isAllowed() ? "allowed" : "rejected")
                    .increment();

            if (!result.isAllowed()) {
                violationPublisher.publishAsync(context, rule);
            }

            return result;
        } catch (Exception e) {
            // FAIL-OPEN: if anything goes wrong, allow the request
            meterRegistry.counter("rate_limit_errors", "type", e.getClass().getSimpleName()).increment();
            return RateLimitResult.allowed();
        }
    }

    private String buildKey(RateLimitContext ctx, ResolvedRule rule) {
        return switch (rule.getScope()) {
            case "PER_IP" -> ctx.ip() + ":" + hashEndpoint(ctx.endpoint());
            case "PER_API_KEY" -> ctx.apiKey() + ":" + hashEndpoint(ctx.endpoint());
            case "PER_USER" -> ctx.userId() + ":" + hashEndpoint(ctx.endpoint());
            case "GLOBAL" -> "global:" + hashEndpoint(ctx.endpoint());
            default -> ctx.clientId() + ":" + hashEndpoint(ctx.endpoint());
        };
    }
}
```

### Backend Code Example — Rule Management Service

```java
@Service
public class RateLimitRuleService {

    private final RateLimitRuleRepository ruleRepository;
    private final RuleChangePublisher ruleChangePublisher;

    public RateLimitRuleService(RateLimitRuleRepository ruleRepository,
                                 RuleChangePublisher ruleChangePublisher) {
        this.ruleRepository = ruleRepository;
        this.ruleChangePublisher = ruleChangePublisher;
    }

    @Transactional
    public RuleResponse createRule(CreateRuleRequest req, String createdBy) {
        if (ruleRepository.existsByName(req.name())) {
            throw new ConflictException("RULE_NAME_EXISTS");
        }

        RateLimitRuleEntity entity = RateLimitRuleEntity.builder()
                .name(req.name())
                .description(req.description())
                .scope(req.scope())
                .endpointPattern(req.endpointPattern())
                .method(req.method())
                .algorithm(req.algorithm())
                .maxRequests(req.maxRequests())
                .windowSeconds(req.windowSeconds())
                .burstSize(req.burstSize())
                .plan(req.plan())
                .priority(req.priority())
                .enabled(req.enabled())
                .createdBy(createdBy)
                .build();

        ruleRepository.save(entity);

        ruleChangePublisher.publish(RuleChangedEvent.created(entity));

        return RuleResponse.from(entity);
    }
}
```

### Frontend Code Example (React + TypeScript) — Rule Management

```tsx
import { useState, useEffect } from "react";

interface RateLimitRule {
  id: number;
  name: string;
  scope: string;
  endpointPattern: string;
  algorithm: string;
  maxRequests: number;
  windowSeconds: number;
  burstSize: number;
  plan: string;
  enabled: boolean;
}

export function RuleList() {
  const [rules, setRules] = useState<RateLimitRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/rules", {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((res) => res.json())
      .then((data) => setRules(data.items))
      .finally(() => setLoading(false));
  }, []);

  async function toggleRule(rule: RateLimitRule) {
    await fetch(`/api/v1/rules/${rule.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify({ ...rule, enabled: !rule.enabled }),
    });
    setRules((prev) =>
      prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r))
    );
  }

  if (loading) return <p>Loading rules...</p>;

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Scope</th>
          <th>Endpoint</th>
          <th>Algorithm</th>
          <th>Limit</th>
          <th>Window</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {rules.map((rule) => (
          <tr key={rule.id}>
            <td>{rule.name}</td>
            <td>{rule.scope}</td>
            <td>{rule.endpointPattern}</td>
            <td>{rule.algorithm}</td>
            <td>{rule.maxRequests} req / {rule.windowSeconds}s</td>
            <td>{rule.windowSeconds}s</td>
            <td>{rule.enabled ? "Active" : "Disabled"}</td>
            <td>
              <button onClick={() => toggleRule(rule)}>
                {rule.enabled ? "Disable" : "Enable"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

### Service Communication Patterns
- **In-process**: Rate Limit Library gọi trực tiếp trong application process (method call, không qua network).
- **Sync REST**: Dashboard → Rule Service cho CRUD operations.
- **Async event**: Rule Service → Kafka → All service instances (rule change broadcast).
- **Async event**: Rate Limit Library → Kafka → Violation Aggregator (violation events).
- **Shared libs**: `rate-limit-core` library (algorithm implementations, Redis client, rule evaluator, metrics).

## 10. 🏛️ Architecture Design
- Pattern chính: **Embedded Library + Centralized Redis + Event-driven rule sync**.
- Critical path (rate limit check): in-process rule evaluation → Redis atomic operation → return result. Không có inter-service hop.
- Rule management: standalone Rule Service với PostgreSQL, broadcast changes qua Kafka.
- Deployment trên **AWS EKS** multi-AZ.

### Architecture Diagram

```mermaid
flowchart TB
    subgraph Internet
        C[API Clients]
    end

    subgraph AWS_Edge
        R53[Route53]
        CF[CloudFront]
        WAF[AWS WAF]
    end

    subgraph AWS_VPC
        ALB[Application Load Balancer]

        subgraph EKS
            subgraph Services["Microservices with Rate Limit Library"]
                GW["API Gateway\n+ RL Library"]
                SVC1["Product Service\n+ RL Library"]
                SVC2["Order Service\n+ RL Library"]
            end
            RS[Rule Management Service]
            VA[Violation Aggregator]
            DASH[Dashboard Service]
        end

        REDIS[(ElastiCache Redis\nCounters)]
        RDS[(RDS PostgreSQL\nRules + Violations)]
        MSK[(Amazon MSK / Kafka)]
        CW[CloudWatch]
        AMG[Managed Prometheus/Grafana]
    end

    C --> R53 --> CF --> WAF --> ALB --> GW
    GW --> SVC1
    GW --> SVC2
    GW --> REDIS
    SVC1 --> REDIS
    SVC2 --> REDIS
    RS --> RDS
    RS --> MSK
    MSK --> GW
    MSK --> SVC1
    MSK --> SVC2
    MSK --> VA
    VA --> RDS
    DASH --> RDS
    DASH --> AMG

    GW -.metrics.-> CW
    GW -.logs.-> CW
    SVC1 -.metrics.-> AMG
    SVC1 -.logs.-> CW
    SVC2 -.metrics.-> AMG
    SVC2 -.logs.-> CW
    RS -.metrics.-> AMG
    RS -.logs.-> CW
```

### Scaling Strategy
- **Rate Limit Library**: scale theo host service — không có pods riêng cho rate limiting. Nếu Product Service scale 2→10 pods, rate limiting scale theo.
- **Redis**: ElastiCache r6g.medium (2 nodes: primary + replica). Peak ~58K ops/sec `[C2]` comfortably fit trong 1 node (~100K ops/sec capacity). Nếu cần scale: enable cluster mode, thêm shards.
- **Rule Service**: HPA min=2, max=4 (low traffic, chỉ admin operations). Cần HA cho startup rule loading.
- **Violation Aggregator**: HPA min=1, max=4 theo Kafka consumer lag. ~5M violations/day `[C5]` → ~58 events/sec avg.
- **PostgreSQL**: RDS r6g.large Multi-AZ đủ cho rules table nhỏ + violations data.

### Caching Strategy
- **L1 — In-process rule cache**: Tất cả active rules cached in-memory (~2.5MB `[C7]`). Refresh qua Kafka events (near-realtime) + periodic full reload mỗi 5 phút (safety net).
- **L2 — Redis**: Chỉ dùng cho counters, không cache rules. Counters auto-expire theo TTL.
- **No CDN caching**: Rate limiter là internal infrastructure, không có public-facing content cần CDN.
- **Local counter cache** (optional): Hot keys cache Redis response in-memory 100-500ms. Giảm Redis calls cho viral endpoints nhưng chấp nhận slight over-count.

### Load Balancing / Gateway / Mesh
- **ALB**: Route traffic vào EKS ingress controller. Health check `/actuator/health`.
- **API Gateway (Spring Cloud Gateway)**: Rate limit library nhúng tại đây kiểm tra mỗi request.
- **Service mesh** (optional): mTLS giữa services nội bộ.

### Resilience Patterns
- **Circuit Breaker** (Resilience4j):
  - Library → Redis: failure threshold 50% trong 10 requests, open 30s. **Fallback: fail-open** (allow all requests).
  - Rule Service → PostgreSQL: threshold 50%, open 15s. Fallback: serve từ in-memory cache (stale nhưng vẫn hoạt động).
- **Retry with Backoff**:
  - Redis operations: exponential backoff 5ms → 10ms → 20ms, max 2 retries (rate limit check phải nhanh, không retry nhiều).
  - Kafka publish: 100ms → 200ms → 400ms, max 3 retries (async, latency tolerance cao hơn).
- **Bulkhead**:
  - Redis connection pool riêng cho rate limiting (20 connections) vs application Redis usage (nếu có).
  - Kafka producer pool riêng cho violation events.
- **Timeout**:
  - Redis GET/SET: 5ms. Lua script execution: 10ms.
  - Kafka produce: 100ms (async).
  - Rule Service API: 500ms.
- **Graceful Degradation**:
  - Redis down → **fail-open**: allow all requests, emit high-priority alert. Switch sang local in-memory counting tạm thời (per-pod limits = global limit / pod count).
  - Kafka down → buffer violation events in-memory (bounded queue 10K events), retry publish. Rate limiting vẫn hoạt động bình thường, chỉ violation logging delay.
  - Rule cache stale (Kafka lag) → vẫn serve với rules hiện tại. Periodic full reload mỗi 5 phút là safety net.
- **Request Coalescing**: Không cần — mỗi rate limit check là unique per client, không có shared key miss problem.

## 11. 🧪 Testing Strategy
- **Unit Testing**: JUnit 5 + Mockito cho:
  - Từng algorithm (TokenBucketLimiter, SlidingWindowLimiter, FixedWindowLimiter) — test boundary cases: exactly at limit, over limit, refill timing.
  - RuleEvaluator — test rule matching, priority ordering, override resolution.
  - DistributedRateLimiter — test fail-open behavior khi exception.
  - Coverage target >85% cho `rate-limit-core` library.
- **Integration Testing**: Spring Boot Test + Testcontainers:
  - Redis Testcontainer: test Lua script execution, TTL behavior, concurrent access.
  - PostgreSQL Testcontainer: test rule CRUD, violation aggregation.
  - Kafka Testcontainer: test rule change broadcast, violation event publish/consume.
- **API Contract Testing**: Spring Cloud Contract cho Rule Service REST API.
- **Load Testing**: Gatling kịch bản:
  - Sustained 30K rate limit checks/sec (peak `[C1]`), xác nhận p99 < 5ms.
  - 100K concurrent clients, mỗi client 10 req/sec, verify counter accuracy ≤ 2% over-count.
  - Redis failover scenario: primary down → verify fail-open activates < 1s.
- **Chaos Engineering**: AWS Fault Injection Simulator:
  - Redis node failure → verify fail-open + alert triggered.
  - Network partition giữa app và Redis → verify circuit breaker opens.
  - Kafka broker failure → verify rule cache remains stale-but-functional.
- **E2E Testing**: Playwright cho Dashboard UI (rule CRUD, violation charts, top throttled list).

## 12. 🔒 Security
- **Authentication**: JWT/OAuth2 cho Rule Management API (chỉ admin/platform-ops). Dashboard yêu cầu JWT với read/write role.
- **Authorization**: RBAC — `rate-limit-admin` role cho CRUD rules, `rate-limit-viewer` role cho dashboard/metrics.
- **TLS**: HTTPS cho Rule Service API. Redis in-transit encryption (TLS) cho ElastiCache. mTLS nội bộ nếu service mesh enabled.
- **Input validation**:
  - Rule definitions: validate `max_requests > 0`, `window_seconds ∈ [1, 86400]`, `endpoint_pattern` là valid path pattern.
  - Chống injection: parameterized queries (Spring Data JPA), Redis key sanitization (strip special chars).
- **DDoS/bot protection**: WAF là tuyến đầu tiên, rate limiter là tuyến thứ hai. Rate limiter bản thân được bảo vệ bởi WAF.
- **Data protection**: Redis encryption at rest (ElastiCache), RDS encryption at rest (KMS). Counters không chứa PII (chỉ hash của client identifier).
- **Secrets management**: Redis auth token, DB credentials lưu trong AWS Secrets Manager. Inject vào pods qua External Secrets Operator, rotate mỗi 90 ngày.
- **Anti-bypass**: Rate limiting enforce tại API Gateway layer — clients không thể bypass bằng cách gọi thẳng backend services (backend services chỉ accessible qua internal network, không expose public).
- **OWASP Top 10**:
  - Injection: parameterized queries, Redis Lua scripts pre-loaded (không dynamic script).
  - Broken auth: JWT short-lived (15 min), admin endpoints require MFA.
  - Security misconfiguration: hardened containers, non-root, read-only filesystem.
- **Compliance**: Rate limit counters không chứa PII (chỉ hash key). Violations table lưu `client_id` (API key hoặc IP) — không phải personal data theo GDPR definition. Nếu `client_id` linkable tới individual (ví dụ: user-id dạng email), cần data processing agreement và retention policy phải tuân thủ right-to-erasure. Data residency: tất cả data lưu trong region `ap-southeast-1`, không cross-region transfer (trừ DR với Global Datastore — encrypted in transit).

## 13. 📊 Monitoring & Logging

### Key Metrics
| Nhóm | Metrics |
|---|---|
| Latency | p50/p95/p99 rate limit check latency, Redis round-trip latency, Lua script execution time |
| Traffic | Rate limit checks/sec (per rule, per service), allowed vs rejected ratio |
| Errors | Redis error rate, fail-open activation count, Lua NOSCRIPT errors |
| Saturation | Redis memory%, Redis ops/sec vs capacity, Kafka consumer lag, rule cache size |
| Business | Top 10 throttled clients, rules with highest rejection rate, violation count per rule |

### Logging Strategy
- Structured JSON logs với fields: `traceId`, `requestId`, `clientId`, `ruleId`, `ruleName`, `result` (allowed/rejected), `remaining`, `latencyMs`.
- Log levels:
  - `INFO`: rule created/updated/deleted, violation aggregation completed.
  - `WARN`: fail-open activated, Redis retry, rule cache stale.
  - `ERROR`: Redis connection failed, circuit breaker opened, Lua script error.
- **Không log mỗi rate limit check** (quá nhiều — ~5.8K/sec). Chỉ log rejections và errors.
- Centralized logging: ELK/OpenSearch, retention 30 ngày.

### SLI / SLO / Error Budget (SRE)
- **SLI check latency**: p99 latency của rate limit check (in-process + Redis round-trip).
- **SLI availability**: tỷ lệ thời gian rate limiter trả kết quả (không fail-open) trong tổng thời gian.
- **SLO check latency**: p99 < 5ms cho 99.9% thời gian đo trong 30-day rolling window.
- **SLO availability**: 99.99% → error budget = 0.01% = tối đa **4.3 phút fail-open/tháng**.
- **Error budget policy**:
  - Budget > 50%: deploy bình thường.
  - Budget 20-50%: canary chặt cho library updates, tăng Redis monitoring.
  - Budget < 20%: freeze library releases, focus Redis stability. Postmortem bắt buộc.

### Alerting & Incident Response
- Alert nếu `rate_limit_check p99 > 10ms` trong 3 phút (double SLO target).
- Alert nếu `fail_open_count > 0` trong 1 phút (Redis issue detected).
- Alert nếu `Redis memory > 80%` (approaching capacity).
- Alert nếu `rejection_rate > 10%` trên bất kỳ rule nào trong 5 phút (possible attack hoặc misconfigured rule).
- Alert nếu `Kafka consumer lag > 50K` trong 10 phút (violation aggregation falling behind).
- Runbook:
  1. Detect: xác nhận alert + dashboard correlation (latency, fail-open, Redis health).
  2. Triage: phân loại nguyên nhân (Redis, network, rule misconfiguration, traffic spike).
  3. Mitigate: rollback rule mới, scale Redis/read replica, bật emergency limits ở WAF nếu cần.
  4. Postmortem: hoàn tất RCA trong 24h, tạo action items có owner + due date.
- Distributed tracing: OpenTelemetry spans cho rate limit check (library tự instrument).

## 14. 🔧 Maintenance
- **CI/CD**:
  - `rate-limit-core` library: build → unit test → integration test → publish to Maven repo. Semantic versioning (major for breaking changes).
  - `rule-service`: build → test → security scan (Trivy + SAST) → deploy staging → smoke test → deploy production.
- **Library versioning**: Backwards-compatible API. Breaking changes require major version bump + migration guide. All services should update within 2 sprints.
- **Database migration**: Flyway versioned migrations, backward-compatible strategy.
- **Dependency management**: Renovate auto-update PRs, SCA scan (Snyk).
- **Redis Lua scripts**: Versioned cùng library. Script loaded via `SCRIPT LOAD` on startup + `EVALSHA`. Fallback `EVAL` nếu script bị evicted.
- **Feature flags**: LaunchDarkly cho rollout new algorithms, dynamic throttling feature.
- **Documentation**: OpenAPI/Swagger cho Rule Service API, library Javadoc, ADR cho algorithm choices.
- **Technical debt**: 10-15% sprint capacity cho debt. Quarterly review library API surface, deprecate unused features.

## 15. 🚀 Deployment Plans
### Deployment Strategy
- `rate-limit-core` library: deployed as Maven dependency — each service picks up new version on their own release cycle. Canary qua feature flags cho new algorithm implementations.
- `rule-service`: Rolling update (low traffic, admin operations).
- Dashboard: Rolling update.

### Rollback Plan
- Library: service rollback to previous version (`kubectl rollout undo`). Rules in Redis/DB không bị ảnh hưởng.
- Rule Service: `kubectl rollout undo` + Flyway undo migration nếu cần.
- Redis Lua scripts: library tự load script version tương ứng.

### IaC
- Terraform modules cho:
  - VPC (multi-AZ, private subnets cho Redis/RDS)
  - EKS (managed node groups)
  - ElastiCache Redis (cluster mode, encryption, Multi-AZ)
  - RDS PostgreSQL (Multi-AZ, parameter groups)
  - MSK/Kafka (multi-AZ brokers, 3 partitions cho `rate-limit-rules` topic)
  - IAM (service roles, pod identity)

### Auto-scaling
- Rate limiting scales với host service (HPA của từng service).
- Rule Service: HPA min=2, max=4 (CPU 70%).
- Violation Aggregator: HPA min=1, max=4 (Kafka consumer lag).
- **Cluster Autoscaler**: EKS Cluster Autoscaler monitors pending pods, scale node group min=2, max=10 nodes. ASG thresholds: scale-out khi average CPU > 70%, scale-in khi < 30% trong 10 phút.

### Multi-region
- Active-passive. Redis Global Datastore cho cross-region replication (counters replicated async). Rule Service primary trong 1 region, read replica + Kafka MirrorMaker cho DR.

### Artifacts
- Docker multi-stage build cho Spring Boot services.
- Helm charts cho rule-service, violation-aggregator, dashboard.
- Library published to internal Maven repository.

### Pre-prod Gate
- integration test + load test (30K checks/sec) + chaos test (Redis failover) trước production.


## 16. ⏱️ Effort Estimation

### Phase Breakdown & Timeline
| Phase | Duration | Deliverables |
|---|---|---|
| Discovery & Design | 1 tuần | Algorithm comparison, API contract, Redis schema design, library API design |
| Core Library (Token Bucket + Redis) | 2 tuần | rate-limit-core library: Token Bucket algorithm, Redis Lua scripts, fail-open, metrics |
| Rule Service + Kafka Sync | 1.5 tuần | Rule CRUD API, Kafka publish/subscribe, in-memory cache sync |
| Additional Algorithms + Overrides | 1 tuần | Sliding Window, Fixed Window implementations, override support |
| Gateway Integration | 1 tuần | Integrate library vào API Gateway, rate limit headers, 429 response |
| Dashboard + Violation Tracking | 1.5 tuần | Dashboard UI (React), violation aggregator, top throttled clients |
| Testing + Hardening | 1.5 tuần | Load test (30K QPS), chaos test (Redis failover), security review |
| **Total** | **~10 tuần** | **Production v1** |

### Team Composition
| Role | Số lượng | Responsibilities |
|---|---|---|
| Tech Lead | 1 | Architecture, algorithm design, trade-offs review |
| Backend Engineers | 2 | Core library, Rule Service, Violation Aggregator, Redis integration |
| Frontend Engineer | 0.5 | Dashboard UI (part-time, có thể share với team khác) |
| DevOps Engineer | 1 | EKS, Redis cluster, Kafka, Terraform, monitoring |
| QA Engineer | 1 | Test automation, load testing, chaos testing |

### Risk Assessment
| Risk | Impact | Mitigation |
|---|---|---|
| Redis latency spike ảnh hưởng tất cả API calls | Tăng latency toàn platform | Fail-open circuit breaker, local counter fallback, Redis cluster mode cho HA |
| Library version inconsistency across services | Rules behave differently trên khác services | Strict semantic versioning, compatibility tests, deprecation period |
| Rule misconfiguration block legitimate traffic | Revenue loss, user experience kém | Rule validation (min/max limits), dry-run mode cho new rules, quick disable toggle |
| Clock skew affect token bucket accuracy | Over/under counting | Dùng Redis server time (`redis.call('TIME')`), không dùng client time |
| Kafka lag delay rule propagation | Stale rules trên một số instances | Periodic full reload mỗi 5 phút, startup block until cache warm |

### Dependencies & Blockers
- Cần Redis cluster provisioning từ platform team (ElastiCache setup + security groups).
- Cần Kafka topic provisioning (`rate-limit-rules`, `rate-limit-violations`).
- Cần API Gateway team agree nhúng rate-limit-core library.
- Cần security review cho Redis auth + Lua scripts.
- Cần agreement on library ownership + release process across teams.

## 17. 💰 Cost Estimation & Optimization

### 17.1 Chi phí hàng tháng theo từng resource

> 📌 Giá tham chiếu theo **AWS On-Demand** ở region `ap-southeast-1` (Singapore). Sizing truy nguồn về Capacity Estimation §2.3.

**Compute (EKS)**

| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| EKS Control Plane | Managed | 1 cluster (shared) | $73 | **$73** | Shared với các services khác |
| Rule Service pods | t3.medium (2 vCPU, 4GB) | 2 pods (HA) | ~$30/pod | **$60** | Low traffic, admin only |
| Violation Aggregator pods | t3.medium | 1-4 pods | ~$30/pod | **$60** | Kafka consumer, HPA theo lag `[C5]` |
| Dashboard Service pods | t3.small (2 vCPU, 2GB) | 2 pods | ~$15/pod | **$30** | BFF cho UI |

> 📌 Rate limit library chạy in-process trong host services → **không có compute cost riêng** cho rate limiting. Cost phân bổ vào từng service.

**Subtotal Compute: ~$223/tháng** (dedicated cho rate limiter infra)

**Database**

| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| RDS PostgreSQL Multi-AZ | db.r6g.large (2 vCPU, 16GB) | 1 primary + 1 standby | ~$274 × 2 | **$548** | Rules ~5K rows `[C6]`, violations ~150M rows/month `[C5]` |
| RDS Storage (gp3) | 100GB initial | 1 | $0.08/GB | **$8** | Violations table grows ~1.5GB/day → ~45GB/month |

**Subtotal Database: ~$556/tháng**

**Cache (Redis)**

| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| ElastiCache Redis | r6g.medium (2 vCPU, 6.38GB) | 2 nodes (primary + replica, Multi-AZ) | ~$110/node | **$220** | ~1GB counters `[C4]`, headroom lớn. Peak ~58K ops/sec `[C2]` |

**Subtotal Cache: ~$220/tháng**

**Message Queue**

| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| Amazon MSK | kafka.t3.small (2 vCPU, 2GB) | 3 brokers (multi-AZ) | ~$35/broker | **$105** | 2 topics, low throughput (~60 events/sec violations) |
| MSK Storage | 20GB per broker | 3 | $0.10/GB | **$6** | Retention 7 ngày, minimal data |

**Subtotal Message Queue: ~$111/tháng**

**Network**

| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| NAT Gateway | Standard | 2 (multi-AZ) | ~$32/gateway | **$64** | Shared với các services khác |
| ALB | Shared | 1 | ~$22 + LCU | **$30** | Rule Service + Dashboard endpoints |
| Route53 | Hosted zone | 1 zone | $0.50 | **$1** | Internal DNS |

**Subtotal Network: ~$95/tháng**

**Monitoring / Logging**

| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| CloudWatch | Metrics + alarms | — | — | **$50** | Rate limit specific metrics + alarms |
| Managed Prometheus + Grafana | Custom metrics | — | — | **$80** | Rate limit dashboards, per-rule metrics |

**Subtotal Monitoring: ~$130/tháng**

**Misc**

| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| AWS Secrets Manager | Redis auth, DB creds | 3 secrets | $0.40/secret | **$1.20** | |
| ECR | Container images | — | $0.10/GB | **$2** | ~20GB images |

**Subtotal Misc: ~$3.20/tháng**

### 17.2 Tổng hợp cost theo giai đoạn

| Giai đoạn | Monthly Cost | Annual Cost | Ghi chú |
|---|---|---|---|
| **MVP** (single Redis node, min replicas) | **~$800** | **~$9,600** | t3.small Redis, single RDS, no Kafka (violations log local) |
| **Growth** (avg traffic — bảng 17.1) | **~$1,338** | **~$16,056** | Full setup như 17.1 |
| **Peak / Scale** (100% design load) | **~$2,000** | **~$24,000** | Upgrade Redis r6g.large, thêm violation aggregator pods, RDS storage tăng |

### 17.3 Cost Breakdown theo category

| Category | USD/tháng (Growth) | % tổng cost |
|---|---|---|
| Database (RDS) | $556 | 42% |
| Compute (EKS pods) | $223 | 17% |
| Cache (ElastiCache Redis) | $220 | 16% |
| Monitoring | $130 | 10% |
| Message Queue (MSK) | $111 | 8% |
| Network | $95 | 7% |
| Misc | $3 | <1% |
| **Tổng** | **~$1,338** | **100%** |

> 📌 **Database chiếm ~42% tổng cost** — chủ yếu do Multi-AZ requirement. Rate limiter bản thân là lightweight service, cost thấp hơn đáng kể so với URL Shortener hay Paste Bin vì không có user-facing content storage.

### 17.4 Cost Optimization Strategies

| Strategy | Mô tả | Tiết kiệm ước tính | Trade-off |
|---|---|---|---|
| **Reserved Instances (1 năm)** | RI cho RDS + ElastiCache (always-on) | ~30-40% DB + Cache = **~$230/tháng** | Commit 1 năm |
| **Right-sizing RDS** | Start db.t3.medium (MVP) → upgrade khi violations table > 50GB | **~$350/tháng** ở MVP phase | Monitor performance sát, t3 có credit-based CPU |
| **Skip MSK ở MVP** | Violations log to file/CloudWatch → aggregate offline. Add Kafka khi scale | **~$111/tháng** | Mất real-time violation tracking |
| **Graviton instances** | Dùng t4g/r7g thay t3/r6g — giá rẻ hơn ~20% | **~$50/tháng** | Cần test ARM compatibility |
| **Single-AZ Redis ở dev/staging** | Chỉ Multi-AZ ở production | **~$110/tháng** cho non-prod | Không HA ở non-prod |
| **Violation data compression** | Aggregate violations hourly thay vì per-event, giảm DB rows | Giảm RDS storage growth 80% | Mất granularity |

### 17.5 Cost Projection (12-24 tháng)

Giả sử traffic tăng **20%/quý**:

| Tháng | Traffic estimate | Infra changes | Monthly Cost |
|---|---|---|---|
| 1-3 (MVP) | 10% peak QPS | Single Redis node, min sizing | ~$800 |
| 4-6 | 30% peak QPS | Add Kafka, Redis replica | ~$1,100 |
| 7-9 | 60% peak QPS | Full setup 17.1 | ~$1,338 |
| 10-12 | 100% peak QPS | Upgrade Redis r6g.large, thêm VA pods | ~$1,800 |
| 13-18 | 150% peak QPS | Redis cluster mode (2 shards), RDS upgrade | ~$2,500 |
| 19-24 | 200%+ peak QPS | Evaluate Redis Cluster scaling, partition violations | ~$3,500 |

> 📌 **Điểm inflection**: tháng 13-18 khi Redis single node approach max ops/sec (~100K), cần enable cluster mode.

### 17.6 Cost Alerts & Governance

- **AWS Budget alerts**:
  - 80% budget ($1,070): email notification cho DevOps.
  - 100% budget ($1,338): alert Slack channel.
  - 120% budget ($1,606): auto-trigger cost review.
- **Quy trình review cost**:
  - **Monthly**: DevOps review cost dashboard, check Redis memory utilization, RDS storage growth.
  - **Quarterly**: Tech lead review scaling projection, RI/SP commitments.
- **Tagging strategy**: tất cả resources tagged theo:
  - `team:platform-infra`
  - `service:rate-limiter`
  - `component:{rule-service|violation-aggregator|redis|dashboard}`
  - `environment:{dev|staging|production}`
- **Cost allocation**: Rate limiter cost thuộc platform/infra team budget, không phân bổ cho từng product team (shared infrastructure).
