# Chat System (WhatsApp/Messenger) - System Design

## 1. 📋 Đề Bài (Problem Statement)
- Thiết kế hệ thống nhắn tin thời gian thực (real-time messaging) tương tự WhatsApp / Facebook Messenger, cho phép người dùng gửi và nhận tin nhắn tức thì.
- Hệ thống phải hỗ trợ chat 1-1, chat nhóm, trạng thái online/offline, xác nhận đã nhận/đã đọc (read receipts), và gửi media (ảnh, file).
- **Scope chính** (in scope):
  - Chat 1-1 real-time
  - Chat nhóm (lên đến 200 thành viên)
  - Trạng thái online/offline và "đang gõ" (typing indicator)
  - Xác nhận gửi / đã nhận / đã đọc (sent/delivered/read)
  - Gửi media (ảnh, file) kèm tin nhắn
  - Lịch sử tin nhắn (message history) với phân trang
  - Push notification cho user offline
- **Scope ngoài bài** (out of scope): end-to-end encryption (E2EE), voice/video call, stories/status, payment integration, chatbot/AI assistant.
- **Mục tiêu business**: cung cấp nền tảng giao tiếp real-time ổn định, low-latency, phục vụ hàng chục triệu người dùng đồng thời.

## 2. 🔍 Requirement Gathering & Analysis

### 2.1 Functional Requirements
| Priority | Requirement | Mô tả |
|---|---|---|
| MUST-HAVE | Send/receive message | User gửi tin nhắn text và nhận tin nhắn real-time qua WebSocket |
| MUST-HAVE | 1-1 chat | Hai user có thể nhắn tin riêng với nhau |
| MUST-HAVE | Group chat | Tạo nhóm chat lên đến 200 thành viên |
| MUST-HAVE | Message delivery status | Trạng thái: sent → delivered → read cho mỗi tin nhắn |
| MUST-HAVE | Online/Offline status | Hiển thị trạng thái online/offline và "last seen" |
| MUST-HAVE | Message history | Load lịch sử tin nhắn theo phân trang (cursor-based) |
| MUST-HAVE | Push notification | Gửi push notification khi user offline nhận tin nhắn mới |
| NICE-TO-HAVE | Typing indicator | Hiển thị "đang gõ..." khi user đang soạn tin nhắn |
| NICE-TO-HAVE | Media messages | Gửi ảnh, file đính kèm (lên đến 25MB) |
| NICE-TO-HAVE | Reply & Forward | Reply trực tiếp 1 tin nhắn, forward tin nhắn sang conversation khác |
| NICE-TO-HAVE | Mute conversation | Tắt thông báo cho conversation cụ thể |

### 2.2 Non-Functional Requirements
- **Performance**: Message delivery end-to-end p95 < 200ms (cả hai user online). Load history p95 < 100ms (cache hit).
- **Scalability**: Hỗ trợ 50M DAU, peak 15M concurrent WebSocket connections, peak ~116K write QPS.
- **Availability**: SLA 99.99% cho message delivery path, 99.9% cho management APIs (create group, profile update).
- **Consistency**: Messages trong cùng conversation phải đảm bảo **causal ordering** (tin nhắn gửi trước phải hiển thị trước). Eventual consistency chấp nhận được cho online status (delay < 10s), read receipts (delay < 5s).
- **Security**: JWT cho authentication, TLS end-to-end, rate limiting chống spam, content moderation cơ bản.
- **Cost**: Ước lượng ~$10,000-15,000/tháng cho MVP, scale lên full traffic ~$50,000-80,000/tháng.
- **Observability**: Golden Signals (latency, error, traffic, saturation), distributed tracing cho message delivery path, alert khi delivery latency p99 > 500ms.

### 2.3 Capacity Estimation (Back-of-the-envelope)

#### Bước 0: Quy ước đơn vị
- `1 day = 86,400 seconds`
- `1M = 1,000,000`, `1B = 1,000,000,000` (Billion, không phải Byte)
- Dùng đơn vị thập phân: `1KB = 1,000B`, `1GB = 1,000,000,000B`

#### Bước 1: Inputs giả định
| Input | Giá trị | Tại sao chọn |
|---|---|---|
| DAU | 50M users/day | Scale tương đương messaging app cỡ vừa-lớn (Zalo ~50M, LINE ~50M) |
| Messages per user per day | 40 messages | WhatsApp trung bình ~65 msg/user/day; chọn 40 cho kịch bản moderate |
| Avg message text size | 100B | Đa số tin nhắn chat ngắn (< 160 ký tự UTF-8) |
| Metadata per message | 100B | message_id (8B), sender_id (8B), conversation_id (8B), timestamp (8B), type (1B), status (1B), reply_to (8B), overhead ~58B |
| Group messages ratio | 30% | 30% tin nhắn gửi trong group, 70% chat 1-1 |
| Avg group size | 20 members | Trung bình nhóm bạn bè/đồng nghiệp |
| Media messages ratio | 5% | 5% tin nhắn có đính kèm media |
| Avg media size | 200KB | Ảnh nén trung bình (JPEG compressed) |
| Peak factor | 5x | Chat traffic tập trung buổi tối 19h-23h |
| Concurrent ratio at peak | 30% DAU | 30% DAU online đồng thời vào giờ cao điểm |

#### Bước 2: Tính write traffic (messages to DB)
- Công thức: `total_messages_per_day = DAU × messages_per_user`
- Thay số: `50,000,000 × 40 = 2,000,000,000 = 2B messages/day`
- Công thức: `write_qps_avg = total_messages_per_day / 86,400`
- Thay số: `2,000,000,000 / 86,400 = 23,148`
- Kết quả: **write QPS trung bình ~23,148**
- Peak factor `x5`: `23,148 × 5 = 115,741`
- Kết quả: **peak write QPS ~115,741**

#### Bước 3: Tính WebSocket delivery traffic
Mỗi message gửi đi cần push tới recipient(s) qua WebSocket:
- 1-1 messages: `2B × 70% × 1 recipient = 1.4B deliveries/day`
- Group messages: `2B × 30% × (20 - 1) members = 11.4B deliveries/day`
- Total deliveries: `1.4B + 11.4B = 12.8B deliveries/day`
- Delivery QPS avg: `12.8B / 86,400 = 148,148`
- Kết quả: **delivery QPS trung bình ~148,148**
- Peak factor `x5`: `148,148 × 5 = 740,741`
- Kết quả: **peak delivery QPS ~740,741**

> 📌 Delivery QPS cao hơn Write QPS vì group messages fan-out tới nhiều recipients. Đây là metric quyết định sizing WebSocket fleet.

#### Bước 4: Tính DB read traffic (history/sync)
Khi user mở app hoặc cuộn lịch sử:
- Mỗi user trung bình 5 lần load history/day (mở 5 conversations)
- Mỗi lần load 20 messages (1 page)
- DB read queries/day: `50M × 5 = 250M queries/day`
- Read QPS avg: `250,000,000 / 86,400 = 2,894`
- Kết quả: **DB read QPS trung bình ~2,894**
- Peak factor `x5`: `2,894 × 5 = 14,468`
- Kết quả: **peak DB read QPS ~14,468**

> 📌 DB Read QPS thấp hơn nhiều so với Write QPS vì ~80% tin nhắn được deliver real-time qua WebSocket (không cần đọc DB). DB chỉ phục vụ history load và offline sync.

#### Bước 5: Tính concurrent WebSocket connections
- Concurrent users at peak: `50M × 30% = 15M connections`
- Memory per connection: ~10KB (buffer + session state)
- Total memory: `15M × 10KB = 150GB`
- Servers capacity: mỗi server (c5.2xlarge, 8 vCPU, 16GB RAM) xử lý ~50K connections
- Số servers: `15,000,000 / 50,000 = 300 servers`
- Kết quả: **15M concurrent connections → ~300 WebSocket server pods**

#### Bước 6: Tính storage (messages)
- Record size: `text + metadata = 100B + 100B = 200B/message`
- Daily storage: `2B × 200B = 400GB/day`
- Yearly storage: `400GB × 365 = 146TB/year`
- With replication factor 3 (Cassandra): `146TB × 3 = 438TB/year`
- Kết quả: **~146TB raw / ~438TB replicated per year**

#### Bước 7: Tính storage (media)
- Media messages/day: `2B × 5% = 100M media/day`
- Daily media storage: `100M × 200KB = 20TB/day`
- Yearly media storage: `20TB × 365 = 7,300TB ≈ 7.3PB/year`
- Kết quả: **~7.3PB/year** (lưu trên S3 với lifecycle policies)

#### Bước 8: Tính cache memory (Redis)
- **Online status**: 50M users × 100B (user_id + status + last_seen) = 5GB
- **Session/routing**: 15M concurrent × 200B (user_id + server_id + connection_id) = 3GB
- **Recent messages cache**: 10M hot conversations × 20 messages × 200B = 40GB
- **Unread counts**: 50M users × 10 conversations × 16B = 8GB
- Total cache: `5 + 3 + 40 + 8 = 56GB` → round to **~60GB Redis cluster**

#### Bước 9: Tính bandwidth
- **Ingress** (message writes): `23,148 × 200B = 4.6MB/s avg`, peak `23MB/s`
- **Egress** (WebSocket delivery): `148,148 × 200B = 29.6MB/s avg`, peak `148MB/s`
- **Media upload**: `100M × 200KB / 86,400 = 231MB/s avg`
- **Media download** (assume 3x reads per media): `694MB/s avg`

#### Bước 10: So sánh kịch bản
| Kịch bản | DAU | Msg/user/day | Write QPS | Concurrent | Storage/year |
|---|---|---|---|---|---|
| Base (moderate) | 10M | 30 | ~3,472 | 3M | ~22TB |
| **Conservative (đang dùng)** | **50M** | **40** | **~23,148** | **15M** | **~146TB** |

> 📌 Kịch bản Conservative được chọn để đảm bảo hệ thống handle được scale lớn. Ở giai đoạn MVP có thể chạy với Base scenario.

#### 📊 Bảng tổng hợp Capacity Estimation

| ID | Metric | Avg | Peak | Quyết định được drive bởi số liệu này |
|---|---|---|---|---|
| C1 | Write QPS (messages) | ~23,148 | **~115,741** | §3.2 Chọn Cassandra (handle 115K writes) · §10 HPA chat-service min=6, max=30 |
| C2 | WebSocket Delivery QPS | ~148,148 | **~740,741** | §5 WebSocket fleet 300 pods · §10 NLB sizing |
| C3 | DB Read QPS (history) | ~2,894 | **~14,468** | §10 Cassandra read consistency · §10 Caching strategy multi-layer |
| C4 | Concurrent connections | — | **15M** | §5 WebSocket servers 300 × 50K conn · §10 NLB cross-zone |
| C5 | Storage/year (messages) | **~146TB** | — | §8 Cassandra partition by conversation_id · §8 TTL 2 years |
| C6 | Storage/year (media) | **~7.3PB** | — | §10 S3 Intelligent-Tiering · §8 Media retention 1 year hot |
| C7 | Cache memory (Redis) | **~60GB** | — | §10 ElastiCache cluster 4×r6g.2xlarge · §10 Presence + routing |
| C8 | Bandwidth egress | ~30MB/s | **~148MB/s** | §10 NLB throughput · §5 WebSocket compression |

## 3. ⚖️ Trade-offs

### 3.1 Bảng tổng quan quyết định
| Decision | Option A | Option B | Chọn | Lý do chính |
|---|---|---|---|---|
| Communication protocol | Long Polling | **WebSocket** | B | Bidirectional real-time, giảm overhead so với polling |
| Message storage | PostgreSQL | **Apache Cassandra** | B | Write-heavy 115K QPS, partition by conversation tự nhiên |
| Message ID | UUID v7 | **Snowflake ID** | B | Time-sortable, compact 64-bit, đảm bảo ordering per conversation |
| Group delivery | Fan-out on Write | **Fan-out on Read** | Hybrid | FoW cho small groups (≤50), FoR cho large groups (>50) |
| Inter-service comm | REST (Spring Boot) | **gRPC (Protobuf)** | B | Giảm ~40% latency cho message delivery critical path |
| Online status | DB Polling | **Heartbeat + Redis** | B | Low latency, TTL-based auto-expire, không cần query DB |

### 3.2 Decision #1: Communication Protocol (Long Polling vs WebSocket)

| Tiêu chí | Long Polling | WebSocket |
|---|---|---|
| Latency | ~1-5s (phụ thuộc poll interval) | ~50-100ms (push ngay lập tức) |
| Server resource | Mỗi poll = 1 HTTP connection, tốn resource | 1 persistent connection, hiệu quả hơn |
| Bidirectional | Không (client → server chỉ qua poll request) | Có (full-duplex communication) |
| Scalability | Cần nhiều HTTP connections hơn ở scale lớn | Ít connections hơn nhưng persistent |
| Complexity | Đơn giản implement | Cần quản lý connection state, reconnect |
| Firewall/Proxy | HTTP chuẩn, ít bị block | Có thể bị block bởi corporate proxy |

#### Long Polling hoạt động thế nào?
1. Client gửi HTTP request tới server: `GET /messages?since=<last_message_id>`
2. Server giữ request mở (hold) cho tới khi có tin nhắn mới hoặc timeout (30s)
3. Khi có tin nhắn mới → server trả response ngay lập tức
4. Client nhận response → xử lý → gửi request mới ngay lập tức
5. Lặp lại vòng lặp

**Ví dụ với số thật**:
- 15M concurrent users, mỗi user 1 long-poll connection
- Poll timeout 30s → mỗi user gửi ~2,880 requests/day (86,400 / 30)
- Total requests/day: `15M × 2,880 = 43.2B requests/day`
- QPS: `43.2B / 86,400 = 500,000 QPS` → overhead rất lớn chỉ để "chờ" tin nhắn

#### WebSocket hoạt động thế nào?
1. Client gửi HTTP Upgrade request: `GET /ws` với header `Upgrade: websocket`
2. Server accept → upgrade connection lên WebSocket (full-duplex)
3. Connection duy trì persistent, cả client và server có thể gửi data bất kỳ lúc nào
4. Server push tin nhắn mới ngay khi có → client nhận tức thì
5. Client gửi tin nhắn → server nhận tức thì (không cần poll)
6. Heartbeat ping/pong mỗi 30s để giữ connection sống

**Ví dụ với số thật**:
- 15M concurrent WebSocket connections
- Mỗi connection chỉ truyền data khi có tin nhắn thực sự
- Heartbeat overhead: 15M × 2 frames/30s × 6B/frame = ~6MB/s → rất nhỏ
- Không có "poll overhead" requests → server chỉ xử lý khi có tin nhắn thật

```java
// Long Polling approach - cần loop liên tục
@GetMapping("/messages")
public DeferredResult<List<Message>> pollMessages(
        @RequestParam Long conversationId,
        @RequestParam Long sinceMessageId) {
    DeferredResult<List<Message>> result = new DeferredResult<>(30000L);
    messageWaitingQueue.add(conversationId, sinceMessageId, result);
    result.onTimeout(() -> result.setResult(Collections.emptyList()));
    return result;
}

// WebSocket approach - push khi có message
@Component
public class ChatWebSocketHandler extends TextWebSocketHandler {
    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        ChatMessage msg = objectMapper.readValue(message.getPayload(), ChatMessage.class);
        chatService.processAndDeliver(msg);
    }

    public void pushToUser(String userId, ChatMessage message) {
        WebSocketSession session = sessionRegistry.getSession(userId);
        if (session != null && session.isOpen()) {
            session.sendMessage(new TextMessage(objectMapper.writeValueAsString(message)));
        }
    }
}
```

**Kết luận**: Chọn **WebSocket** vì:
- Chat system yêu cầu real-time bidirectional communication (gửi tin nhắn + nhận tin nhắn + typing indicator)
- Giảm 99% overhead so với Long Polling ở 15M concurrent users `[C4]`
- Latency ~50-100ms phù hợp target p95 < 200ms
- **Mitigation cho nhược điểm**: Fallback sang Long Polling khi WebSocket bị block bởi proxy; auto-reconnect với exponential backoff khi connection drop

### 3.3 Decision #2: Message Storage (PostgreSQL vs Cassandra)

| Tiêu chí | PostgreSQL | Apache Cassandra |
|---|---|---|
| Write throughput | Single-master, max ~10-20K QPS với tuning | Linear scale, dễ dàng handle 100K+ QPS |
| Partitioning | Table partitioning (cần quản lý thủ công) | Built-in partitioning (partition key = conversation_id) |
| Data model | Relational, cần JOIN cho complex queries | Wide-column, query by partition key + clustering key |
| Consistency | Strong (ACID) | Tunable (ONE → QUORUM → ALL) |
| Horizontal scaling | Read replicas only, write = single master | Add nodes → auto-rebalance, no master |
| Operations complexity | Mature tooling, DBA quen thuộc | Cần chuyên gia, tuning compaction/gc |
| Query flexibility | SQL đầy đủ, ad-hoc queries | Chỉ query theo partition key + clustering key |

#### PostgreSQL cho messages hoạt động thế nào?
1. Single-master nhận tất cả writes
2. Replication sang read replicas (async, ~100ms lag)
3. Table partitioned by `conversation_id` hash hoặc range
4. Khi scale: cần manual shard splitting, application-level routing

**Ví dụ ở peak traffic**:
- Peak write QPS: 115,741 `[C1]`
- PostgreSQL single master với pgbouncer: max ~20K QPS (optimistic)
- Cần sharding 6+ masters → phức tạp vận hành (cross-shard queries, distributed transactions)
- Read replicas cho history queries: replication lag → user có thể không thấy tin nhắn vừa gửi

#### Cassandra cho messages hoạt động thế nào?
1. Message insert với partition key = `conversation_id`, clustering key = `message_id` DESC
2. Tất cả messages của 1 conversation nằm trên cùng partition → read sequential
3. Write đến bất kỳ node nào (no single master), coordinator route tới replica nodes
4. Consistency level: `LOCAL_QUORUM` cho write (2/3 replicas ACK), `LOCAL_ONE` cho read (1 replica đủ)

**Ví dụ ở peak traffic**:
- Peak write QPS: 115,741 `[C1]`
- Cassandra cluster 12 nodes (i3.2xlarge): mỗi node handle ~10K writes/s → total ~120K QPS → đủ
- Thêm nodes khi cần scale → linear, không downtime
- Read by partition key: `SELECT * FROM messages WHERE conversation_id = ? ORDER BY message_id DESC LIMIT 20` → single partition read, rất nhanh

```sql
-- PostgreSQL: cần table partitioning + sharding
CREATE TABLE messages (
    id BIGINT PRIMARY KEY,
    conversation_id BIGINT NOT NULL,
    sender_id BIGINT NOT NULL,
    content TEXT,
    created_at TIMESTAMP NOT NULL
) PARTITION BY HASH (conversation_id);
-- Cần tạo partitions thủ công, quản lý shard routing

-- Cassandra: partitioning built-in
CREATE TABLE messages (
    conversation_id BIGINT,
    message_id BIGINT,
    sender_id BIGINT,
    content TEXT,
    type TEXT,
    media_url TEXT,
    reply_to_message_id BIGINT,
    created_at TIMESTAMP,
    PRIMARY KEY (conversation_id, message_id)
) WITH CLUSTERING ORDER BY (message_id DESC)
  AND default_time_to_live = 63072000; -- TTL 2 years
```

**Kết luận**: Chọn **Cassandra** cho message storage vì:
- Write-heavy workload 115K peak QPS `[C1]` → Cassandra linear scale, PostgreSQL bottleneck ở single master
- Partition by `conversation_id` tự nhiên → messages cùng conversation co-located, read nhanh
- 146TB/year storage `[C5]` → Cassandra handle petabyte-scale, built-in compaction
- **Mitigation**: Dùng PostgreSQL cho user/group metadata (cần ACID, JOIN, flexible queries); Cassandra chỉ cho messages

> 💡 **Tại sao không dùng PostgreSQL (default stack)?**
> PostgreSQL single-master architecture không scale được tới 115K peak write QPS `[C1]` mà không cần complex sharding. Cassandra wide-column model với partition key = conversation_id là natural fit cho chat messages (time-series, write-heavy, query by conversation). Trade-off: mất SQL flexibility, nhưng message queries chỉ cần `WHERE conversation_id = ? ORDER BY message_id DESC LIMIT N` — Cassandra xử lý tối ưu.

### 3.4 Decision #3: Message ID (UUID v7 vs Snowflake ID)

| Tiêu chí | UUID v7 | Snowflake ID |
|---|---|---|
| Size | 128-bit (16 bytes) | 64-bit (8 bytes) |
| Sortable | Time-sortable (timestamp prefix) | Time-sortable (41-bit timestamp) |
| Uniqueness | Globally unique (random suffix) | Unique per worker (worker_id + sequence) |
| Index efficiency | 128-bit index, larger B-tree | 64-bit index, compact B-tree |
| Coordination | Không cần (random) | Cần assign worker_id (nhưng đơn giản) |

**Snowflake ID structure (64-bit)**:
```
| 1 bit unused | 41 bits timestamp (ms) | 10 bits worker_id | 12 bits sequence |
```

- **41 bits timestamp**: ~69 years từ custom epoch
- **10 bits worker_id**: 1024 workers (đủ cho cluster)
- **12 bits sequence**: 4096 IDs/ms/worker = **4,096,000 IDs/s/worker**

**Ví dụ**:
- Timestamp: `2026-03-01T10:00:00.123Z` → offset ms từ epoch
- Worker ID: `17` (pod thứ 17 của Chat Service)
- Sequence: `42` (ID thứ 42 trong ms này)
- Snowflake ID: `7185492039184713770` → Base10, sortable
- So với UUID v7: `019e1234-5678-7abc-def0-123456789abc` → 36 chars string

#### UUID v7 hoạt động thế nào?
1. Lấy timestamp hiện tại theo millisecond
2. Encode timestamp vào phần đầu UUID
3. Sinh random bits cho phần còn lại để đảm bảo uniqueness toàn cục
4. Trả về chuỗi 36 ký tự (hex + dấu `-`)

#### Snowflake ID hoạt động thế nào?
1. Lấy timestamp ms từ custom epoch
2. Gắn `worker_id` để phân biệt node/pod sinh ID
3. Tăng sequence trong cùng millisecond, overflow thì chờ sang millisecond kế tiếp
4. Ghép bit thành số `BIGINT` 64-bit, dùng trực tiếp làm PK/clustering key

```java
// UUID v7 (minh họa)
UUID id = UuidCreator.getTimeOrderedEpoch();

// Snowflake (minh họa)
long id = (timestamp << 22) | (workerId << 12) | sequence;
```

**Kết luận**: Chọn **Snowflake ID** vì:
- Compact 64-bit → tiết kiệm 50% storage/index so với UUID 128-bit, quan trọng ở 146TB/year `[C5]`
- Time-sortable → messages tự động sắp xếp theo thời gian, dùng làm clustering key trong Cassandra
- Throughput: 4M IDs/s/worker đủ cho 115K peak write QPS `[C1]`
- **Mitigation**: Assign worker_id qua environment variable khi pod startup (Kubernetes StatefulSet ordinal hoặc ZooKeeper lease)

### 3.5 Decision #4: Group Message Delivery (Fan-out on Write vs Fan-out on Read)

| Tiêu chí | Fan-out on Write (FoW) | Fan-out on Read (FoR) |
|---|---|---|
| Write amplification | Cao: 1 message → N copies (N = group size) | Thấp: 1 message → 1 copy |
| Read latency | Thấp: read từ per-user inbox, đã sẵn sàng | Cao hơn: cần merge messages từ nhiều sources |
| Storage | N × message size | 1 × message size |
| Delivery speed | Nhanh: push trực tiếp tới mỗi user | Cần pull/merge khi user mở conversation |
| Phù hợp với | Small groups (≤50 members) | Large groups (>50 members), channels |

#### Fan-out on Write hoạt động thế nào?
1. User A gửi message trong group 20 người
2. Chat Service ghi message vào bảng `messages` (1 write)
3. Chat Service tạo 19 delivery records trong bảng `user_inbox` (19 writes)
4. Mỗi online member nhận push qua WebSocket
5. Khi member mở app → read từ `user_inbox` (fast, pre-computed)

**Ví dụ**: Group 20 người, 1 message:
- Writes: 1 (message) + 19 (inbox) = **20 writes**
- Reads khi mỗi member mở app: **1 read/member** (đã index sẵn)

#### Fan-out on Read hoạt động thế nào?
1. User A gửi message trong group 200 người
2. Chat Service ghi message vào bảng `messages` (1 write only)
3. Online members nhận push qua WebSocket (real-time, không cần inbox)
4. Khi member mở app → query `messages WHERE conversation_id = ? AND message_id > last_read_id`

**Ví dụ**: Group 200 người, 1 message:
- Writes: **1 write** (chỉ message table)
- Reads khi mỗi member mở app: **1 query/member** (partition key lookup, nhanh trên Cassandra)

```java
// Fan-out on Write (nhỏ nhóm)
saveMessage(conversationId, message);
for (Long memberId : members) {
    if (!memberId.equals(senderId)) {
        inboxRepository.insert(memberId, message);
    }
}

// Fan-out on Read (nhóm lớn)
saveMessage(conversationId, message);
// Không ghi inbox per-user, chỉ push online users
deliveryService.pushOnlineMembers(conversationId, message);
```

**Kết luận**: Chọn **Hybrid approach**:
- **Fan-out on Write** cho groups ≤50 members: write amplification chấp nhận được (max 50 writes/message), đổi lại read cực nhanh
- **Fan-out on Read** cho groups >50 members: tránh write amplification (1 message trong group 200 → 200 writes = quá nhiều)
- Threshold 50 được chọn vì: ở peak 115K write QPS `[C1]`, nếu tất cả FoW với avg group 20 → actual write QPS = 115K × 30% × 20 = 690K → quá cao. Hybrid giữ actual write QPS ở mức chấp nhận được.

### 3.6 Decision #5: Inter-service Communication (REST vs gRPC)

| Tiêu chí | REST (JSON/HTTP 1.1) | gRPC (Protobuf/HTTP 2) |
|---|---|---|
| Latency | ~5-10ms overhead (JSON parse, text protocol) | ~1-3ms overhead (binary, multiplexing) |
| Throughput | Moderate (text serialization) | High (binary serialization, streaming) |
| Complexity | Đơn giản, mọi team đều biết | Cần proto file, code generation |
| Debugging | Dễ (curl, Postman) | Khó hơn (cần grpcurl, Bloom RPC) |

#### REST (JSON/HTTP 1.1) hoạt động thế nào?
1. WS Gateway nhận message từ client và gọi `POST /internal/messages/deliver` tới Chat Service
2. Payload JSON được serialize ở client-side và parse lại ở server-side
3. Mỗi request cần HTTP headers đầy đủ + kết nối keep-alive riêng theo pool
4. Response trả JSON ACK, sau đó WS Gateway tiếp tục call endpoint khác để push recipient

#### gRPC (Protobuf/HTTP 2) hoạt động thế nào?
1. WS Gateway gọi RPC `DeliverMessage()` qua một HTTP/2 channel persistent
2. Payload được encode Protobuf (binary, compact hơn JSON)
3. Multiplex nhiều stream trên cùng 1 TCP connection giữa pods
4. Chat Service trả response Protobuf, đồng thời gọi RPC push sang WS Gateway đích

**Ví dụ với số thật**:
- Peak delivery QPS: `~740,741` `[C2]`
- Nếu REST overhead thêm trung bình `5ms/call` thì tổng queued processing lớn, dễ kéo p95 vượt 200ms
- Nếu gRPC giảm payload nội bộ từ ~350B (JSON) xuống ~180B (Protobuf) thì giảm băng thông internal đáng kể ở peak egress `[C8]`

```java
// REST style internal call
@PostMapping("/internal/messages/deliver")
public DeliveryAck deliver(@RequestBody DeliveryRequest request) {
    return deliveryService.deliver(request);
}
```

```proto
// gRPC style internal call
rpc DeliverMessage(DeliverMessageRequest) returns (DeliverMessageResponse);
```

**Kết luận**: Chọn **gRPC** cho internal service communication (đặc biệt WS Gateway ↔ Chat Service) vì:
- Message delivery critical path cần latency cực thấp: 740K peak delivery QPS `[C2]` × 5ms REST overhead = bottleneck
- gRPC HTTP/2 multiplexing giảm connection overhead giữa 300 WS Gateway pods và Chat Service pods
- **REST vẫn dùng** cho external APIs (client-facing) và management APIs (CRUD user, group) — dễ integrate, dễ document

> 💡 **Tại sao dùng gRPC thay vì REST (default stack)?**
> Chat system message delivery path yêu cầu latency cực thấp với 740K peak delivery QPS `[C2]`. gRPC (Protobuf + HTTP/2 multiplexing) giảm ~40% latency so với REST + JSON, đồng thời giảm bandwidth cho inter-service communication. REST vẫn dùng cho external-facing APIs.

### 3.7 Decision #6: Online Status (DB Polling vs Heartbeat + Redis)

| Tiêu chí | DB Polling | Heartbeat + Redis |
|---|---|---|
| Latency | Cao (query DB mỗi lần check) | Thấp (~1ms Redis GET) |
| Accuracy | Phụ thuộc poll interval | Real-time (TTL-based, auto expire) |
| DB load | Tăng read QPS cho DB | Không ảnh hưởng primary DB |
| Scale | DB bottleneck ở 50M users | Redis cluster handle millions keys |

#### DB Polling hoạt động thế nào?
1. Client hoặc server định kỳ query DB: `SELECT last_seen FROM users WHERE id = ?`
2. User khác muốn check online status cũng thực hiện query tương tự
3. Nếu poll interval 10s thì trạng thái có thể stale tới 10s
4. Metadata DB phải xử lý thêm lượng read lớn, cạnh tranh tài nguyên với history/metadata reads `[C3]`

#### Heartbeat + Redis hoạt động thế nào?
1. Client gửi heartbeat ping mỗi 30s qua WebSocket
2. WS Gateway nhận → update Redis key: `SET user:status:{userId} ONLINE EX 60`
3. TTL = 60s (2× heartbeat interval) → nếu miss 2 heartbeats → key expires → user = OFFLINE
4. Khi user B muốn check user A online: `GET user:status:{userA_id}` → O(1) lookup
5. Last seen: khi key expire → Presence Service ghi `last_seen` timestamp vào Redis: `SET user:lastseen:{userId} <timestamp>`

**Ví dụ với số thật**:
- Peak concurrent users: `15M` `[C4]`
- Giả sử mỗi user check trạng thái 20 contacts mỗi phút:
  - `15M × 20 / 60 = 5,000,000 status checks/s`
  - Khối lượng này không phù hợp để dồn vào PostgreSQL/Cassandra read path vốn đã dành cho history `[C3]`
- Redis lookup O(1) + TTL xử lý tốt với cache sizing `~60GB` `[C7]`

```java
// DB polling (không chọn)
Instant lastSeen = userRepository.findLastSeen(userId);
boolean online = lastSeen.isAfter(Instant.now().minusSeconds(10));

// Heartbeat + Redis (được chọn)
redisTemplate.opsForValue().set("user:status:" + userId, "ONLINE", Duration.ofSeconds(60));
boolean online = redisTemplate.hasKey("user:status:" + targetUserId);
```

**Kết luận**: Chọn **Heartbeat + Redis** vì:
- 50M users × status check → Redis handle dễ dàng, 60GB cache budget `[C7]` đã tính online status (5GB)
- TTL auto-expire giải quyết edge case user disconnect bất ngờ (crash, mất mạng)
- Không thêm load cho PostgreSQL primary DB, giữ DB read budget cho lịch sử tin nhắn `[C3]`

## 4. 🧩 Defining Entities / Components

### Component Diagram

```mermaid
flowchart LR
    subgraph Edge["Edge Layer"]
        Client["User - Web / Mobile"]
        CloudFront["CloudFront + WAF"]
        ALB["ALB - HTTP L7"]
        NLB["NLB - TCP L4"]
    end

    subgraph Application["Application Layer"]
        WSG["WS Gateway"]
        ChatSvc["Chat Service"]
        UserSvc["User Service"]
        GroupSvc["Group Service"]
        MediaSvc["Media Service"]
        PresenceSvc["Presence Service"]
        NotifSvc["Notification Service"]
    end

    subgraph Data["Data Layer"]
        Cassandra[("Cassandra - Messages")]
        PG[("PostgreSQL - Users, Groups")]
        Redis[("Redis - Cache, Presence")]
        S3[("S3 - Media")]
    end

    subgraph Async["Async Layer"]
        Kafka[/"Kafka - Events"/]
        SNS["FCM / APNs"]
    end

    subgraph Observability["Observability Layer"]
        OBS["Prometheus + Grafana + ELK"]
    end

    Client --> CloudFront
    Client --> NLB
    CloudFront --> ALB
    CloudFront --> S3

    NLB --> WSG
    ALB --> UserSvc
    ALB --> GroupSvc
    ALB --> MediaSvc

    WSG -->|gRPC| ChatSvc
    ChatSvc -->|gRPC push| WSG

    ChatSvc --> Cassandra
    ChatSvc --> Redis
    ChatSvc --> Kafka
    UserSvc --> PG
    GroupSvc --> PG
    PresenceSvc --> Redis
    MediaSvc --> S3
    Kafka --> NotifSvc
    NotifSvc --> SNS

    OBS -. monitor .-> WSG
    OBS -. monitor .-> ChatSvc
    OBS -. monitor .-> NotifSvc
```

### Bảng vai trò từng component

| Component | Vai trò |
|---|---|
| WS Gateway | Quản lý WebSocket connections, authenticate, route messages tới Chat Service, push messages tới clients. Fleet 300 pods `[C4]` |
| Chat Service | Xử lý business logic: validate message, persist vào Cassandra, route delivery, update status. Core service |
| User Service | CRUD user profiles, contacts, authentication (JWT), avatar upload |
| Group Service | Tạo/quản lý group, add/remove members, group settings |
| Presence Service | Quản lý online/offline status, heartbeat processing, last seen |
| Notification Service | Consume message events từ Kafka, gửi push notification (FCM/APNs) cho offline users |
| Media Service | Upload media lên S3, generate thumbnail, trả pre-signed URL cho download |
| Cassandra | Message storage, partitioned by conversation_id, clustering by message_id DESC. 12 nodes `[C1]` |
| PostgreSQL RDS | User profiles, group metadata, conversation metadata. Multi-AZ |
| Redis Cluster | Online status (TTL), session routing, message cache, unread counts. 60GB `[C7]` |
| Kafka (MSK) | Event streaming: message.sent, message.delivered, message.read, user.online, user.offline |
| S3 | Media file storage, lifecycle policies (Intelligent-Tiering) cho 7.3PB/year `[C6]` |

## 5. 🔗 Client-Server Connection

### Protocol
| Connection Type | Protocol | Use Case |
|---|---|---|
| Real-time messaging | **WebSocket** (wss://) | Send/receive messages, typing indicator, presence updates |
| REST API | **HTTPS** (TLS 1.3) | User management, group CRUD, message history, media upload |
| Media delivery | **HTTPS via CloudFront** | Download images, files qua CDN |
| Internal services | **gRPC** (HTTP/2 + Protobuf) | WS Gateway ↔ Chat Service, Chat Service ↔ Presence Service |
| Push notification | **FCM/APNs** | Offline message notification |

### Authentication
- **WebSocket**: JWT token trong query param khi connect (`wss://ws.chat.com/ws?token=<jwt>`). Token validate 1 lần khi handshake, sau đó session giữ authenticated state.
- **REST API**: JWT Bearer token trong `Authorization` header. Token expire 1h, refresh token 30 days.
- **Internal gRPC**: mTLS (mutual TLS) giữa services trong EKS cluster (via service mesh Istio).

### Connection Patterns
| Pattern | Áp dụng ở đâu | Mô tả |
|---|---|---|
| Request-Response | REST APIs qua ALB | CRUD users/groups, load history, media upload |
| Pub-Sub | Kafka topics | `message.sent`, `message.delivered`, `message.read`, `user.online` cho Notification/Analytics |
| Streaming (bidirectional) | WebSocket | Real-time message delivery, typing indicator, read receipt |

### Connection Management
- **WebSocket reconnect**: Client auto-reconnect với exponential backoff (1s, 2s, 4s, 8s, max 30s) + jitter
- **Heartbeat**: Client → Server ping mỗi 30s. Nếu server không nhận ping trong 60s → close connection
- **Connection draining**: Khi WS Gateway pod scale down → graceful drain: stop accepting new connections, wait 30s cho existing connections migrate
- **Session registry**: Redis hash `user:session:{userId}` → `{serverId, connectionId, connectedAt}`. Dùng để route message tới đúng WS Gateway pod
- **WebSocket compression**: bật `permessage-deflate` cho payload text để giảm peak egress bandwidth `[C8]`

### Rate Limiting & Throttling
| Role | Limit | Thuật toán |
|---|---|---|
| Anonymous | Không cho connect WebSocket | — |
| Authenticated (free) | 60 messages/minute, 5 group creates/day | Token Bucket |
| Authenticated (premium) | 300 messages/minute, 50 group creates/day | Token Bucket |
| API endpoints | 100 requests/minute per user | Sliding Window |

### Idempotency
- Mỗi message có `client_message_id` (UUID, client-generated) → Chat Service dedup bằng cách check Redis `SET NX` với TTL 5 min
- Nếu client gửi lại message cùng `client_message_id` (do retry) → server trả lại message đã tạo, không tạo duplicate
- Media upload: `Idempotency-Key` header, lưu trong Redis 1h

## 6. 🔄 System / App Flow

### Flow 1: Gửi tin nhắn 1-1 (Send Direct Message)

```mermaid
sequenceDiagram
    participant A as User A (Sender)
    participant WS1 as WS Gateway #1
    participant CS as Chat Service
    participant DB as Cassandra
    participant R as Redis
    participant K as Kafka
    participant WS2 as WS Gateway #2
    participant B as User B (Recipient)
    participant NS as Notification Service

    A->>WS1: send_message {to: B, content: "Hello!", client_msg_id: "uuid-1"}
    WS1->>CS: processMessage(msg) [gRPC]
    CS->>R: SETNX dedup:uuid-1 EX 300
    R-->>CS: OK (not duplicate)
    CS->>DB: INSERT INTO messages (conv_id, msg_id, sender, content, ...)
    DB-->>CS: ACK
    CS->>K: publish topic=message.sent {msg}
    CS-->>WS1: ACK {message_id: 7185492039184713770, status: SENT}
    WS1-->>A: message_ack {message_id, status: SENT}

    CS->>R: GET user:session:B
    R-->>CS: {serverId: ws-gateway-2, connectionId: conn-456}

    alt User B online
        CS->>WS2: deliverMessage(msg) [gRPC]
        WS2->>B: new_message {from: A, content: "Hello!", message_id: ...}
        B-->>WS2: delivery_ack
        WS2->>CS: updateStatus(msg_id, DELIVERED)
        CS->>WS1: status_update {message_id, status: DELIVERED}
        WS1->>A: message_status {message_id, status: DELIVERED}
    else User B offline
        K->>NS: consume message.sent
        NS->>B: Push Notification (FCM/APNs)
    end
```

**Chi tiết từng bước**:
1. **Client A** gửi message qua WebSocket frame (JSON): `{type: "send_message", to: "user_B_id", content: "Hello!", client_message_id: "uuid-1"}`
2. **WS Gateway #1** validate session, forward tới **Chat Service** qua gRPC
3. **Chat Service** dedup bằng `client_message_id` trong Redis (SETNX, TTL 5 min)
4. Persist message vào **Cassandra** (consistency: LOCAL_QUORUM)
5. Publish event `message.sent` vào **Kafka** (cho Notification Service, Analytics)
6. Trả ACK về client A với `message_id` (Snowflake) và status `SENT`
7. Lookup recipient B's WebSocket server trong **Redis** session registry
8. Nếu online: gRPC call tới WS Gateway #2 → push qua WebSocket → B gửi `delivery_ack` → update status `DELIVERED`
9. Nếu offline: Notification Service consume event từ Kafka → gửi push notification

### Flow 2: Load lịch sử tin nhắn (Message History)

```mermaid
sequenceDiagram
    participant C as Client
    participant ALB as ALB
    participant HS as Chat Service
    participant R as Redis Cache
    participant DB as Cassandra
    participant K as Kafka

    C->>ALB: GET /api/v1/conversations/{id}/messages?before=<cursor>&limit=20
    ALB->>HS: forward request

    HS->>R: GET conv:msgs:{conv_id}:page:{cursor}
    alt Cache HIT
        R-->>HS: [20 messages]
        HS-->>C: 200 OK {messages, next_cursor}
    else Cache MISS
        HS->>DB: SELECT * FROM messages WHERE conversation_id = ? AND message_id < ? ORDER BY message_id DESC LIMIT 20
        DB-->>HS: [20 messages]
        HS->>R: SET conv:msgs:{conv_id}:page:{cursor} EX 300
        HS-->>C: 200 OK {messages, next_cursor}
    end
    HS->>K: publish message.history_viewed {conversationId, userId, pageSize}
```

**Chi tiết**:
- Cursor-based pagination dùng `message_id` (Snowflake, sortable) → hiệu quả hơn offset-based
- Cache TTL 5 phút cho recent pages (page đầu tiên của mỗi conversation)
- Cassandra query by partition key (`conversation_id`) + clustering key range (`message_id < cursor`) → single partition read, rất nhanh, phù hợp read budget `[C3]`
- Event `message.history_viewed` được xử lý async để analytics/pre-compute cache, không nằm trên critical response path

### Flow 3: Gửi tin nhắn group (Group Message)

1. User A gửi message trong group `G1` (20 members)
2. Chat Service persist 1 message vào Cassandra (partition key = group conversation_id)
3. Lookup tất cả members của G1 từ PostgreSQL (cached trong Redis)
4. **Fan-out delivery**: cho mỗi online member → lookup WS Gateway → gRPC push
5. Offline members → batch push notification qua Kafka → Notification Service
6. Nếu group >50 members → Fan-out on Read: chỉ push cho online members, offline members tự sync khi mở app

### Error Handling & Edge Cases

| Error Case | HTTP Status | Behavior |
|---|---|---|
| Conversation not found | 404 Not Found | Client hiển thị "Conversation does not exist" |
| User not a member | 403 Forbidden | Reject message, không persist |
| Message too long (>4KB text) | 400 Bad Request | Client-side validation + server-side reject |
| Duplicate message (same client_message_id) | 200 OK | Trả lại message đã tạo (idempotent) |
| Recipient blocked sender | 200 OK | Message persist nhưng không deliver (silent block) |
| Media upload failed | 500 / retry | Client retry upload, message gửi sau khi upload thành công |
| Cassandra down | 503 Service Unavailable | Circuit breaker open → return error, client retry |
| Redis down | Degraded | Fallback: query Cassandra cho history, disable online status, continue messaging (Kafka + Cassandra vẫn hoạt động) |
| WS Gateway target down | Retry | Chat Service retry gRPC call tới gateway khác nếu user reconnect; nếu vẫn fail → treat as offline → push notification |

## 7. 📡 API Modeling

### Endpoint Definitions (REST)

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/api/v1/auth/login` | No | Đăng nhập, nhận JWT token |
| POST | `/api/v1/auth/refresh` | Yes | Refresh access token |
| GET | `/api/v1/users/me` | Yes | Lấy profile hiện tại |
| PUT | `/api/v1/users/me` | Yes | Cập nhật profile |
| GET | `/api/v1/users/{id}` | Yes | Lấy profile user khác |
| POST | `/api/v1/conversations` | Yes | Tạo conversation mới (1-1 hoặc group) |
| GET | `/api/v1/conversations` | Yes | Danh sách conversations của user |
| GET | `/api/v1/conversations/{id}/messages` | Yes | Lấy lịch sử tin nhắn (cursor-based) |
| POST | `/api/v1/conversations/{id}/members` | Yes | Thêm member vào group |
| DELETE | `/api/v1/conversations/{id}/members/{userId}` | Yes | Xóa member khỏi group |
| POST | `/api/v1/media/upload` | Yes | Upload media file, nhận pre-signed URL |
| POST | `/api/v1/conversations/{id}/read-receipts` | Yes | Đánh dấu đã đọc đến `lastReadMessageId` |

### WebSocket Events

| Direction | Event Type | Payload |
|---|---|---|
| Client → Server | `send_message` | `{conversationId, content, type, clientMessageId, replyToMessageId?, mediaUrl?}` |
| Client → Server | `typing_start` | `{conversationId}` |
| Client → Server | `typing_stop` | `{conversationId}` |
| Client → Server | `read_receipt` | `{conversationId, lastReadMessageId}` |
| Client → Server | `ping` | `{}` (heartbeat) |
| Server → Client | `new_message` | `{messageId, conversationId, senderId, content, type, createdAt}` |
| Server → Client | `message_ack` | `{clientMessageId, messageId, status}` |
| Server → Client | `message_status` | `{messageId, status, updatedAt}` |
| Server → Client | `typing_indicator` | `{conversationId, userId, isTyping}` |
| Server → Client | `presence_update` | `{userId, status, lastSeen?}` |
| Server → Client | `pong` | `{}` |

### Request/Response Examples

**Tạo group conversation**:
```http
POST /api/v1/conversations HTTP/1.1
Host: api.chat.com
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000

{
  "type": "GROUP",
  "name": "Team Backend",
  "memberIds": [1001, 1002, 1003, 1004]
}
```

```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "id": 9001,
  "type": "GROUP",
  "name": "Team Backend",
  "avatarUrl": null,
  "createdBy": 1000,
  "members": [
    {"userId": 1000, "role": "ADMIN", "joinedAt": "2026-03-01T10:00:00Z"},
    {"userId": 1001, "role": "MEMBER", "joinedAt": "2026-03-01T10:00:00Z"},
    {"userId": 1002, "role": "MEMBER", "joinedAt": "2026-03-01T10:00:00Z"},
    {"userId": 1003, "role": "MEMBER", "joinedAt": "2026-03-01T10:00:00Z"},
    {"userId": 1004, "role": "MEMBER", "joinedAt": "2026-03-01T10:00:00Z"}
  ],
  "createdAt": "2026-03-01T10:00:00Z",
  "updatedAt": "2026-03-01T10:00:00Z"
}
```

**Lấy lịch sử tin nhắn (cursor-based pagination)**:
```http
GET /api/v1/conversations/9001/messages?before=7185492039184713770&limit=20 HTTP/1.1
Host: api.chat.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "messages": [
    {
      "messageId": 7185492039184713750,
      "conversationId": 9001,
      "senderId": 1002,
      "senderName": "Nguyen Van B",
      "content": "PR reviewed, LGTM!",
      "type": "TEXT",
      "mediaUrl": null,
      "replyToMessageId": 7185492039184713740,
      "status": "READ",
      "createdAt": "2026-03-01T09:58:30Z"
    },
    {
      "messageId": 7185492039184713740,
      "conversationId": 9001,
      "senderId": 1000,
      "senderName": "Tran Van A",
      "content": "Mọi người review PR #1234 giúp mình nhé",
      "type": "TEXT",
      "mediaUrl": null,
      "replyToMessageId": null,
      "status": "READ",
      "createdAt": "2026-03-01T09:55:00Z"
    }
  ],
  "nextCursor": 7185492039184713730,
  "hasMore": true
}
```

**Đánh dấu đã đọc (read receipt)**:
```http
POST /api/v1/conversations/9001/read-receipts HTTP/1.1
Host: api.chat.com
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Idempotency-Key: 1d7a8b9c-8f21-4f96-b0ef-88f67911ac2d

{
  "lastReadMessageId": 7185492039184713780
}
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "conversationId": 9001,
  "userId": 1000,
  "lastReadMessageId": 7185492039184713780,
  "updatedAt": "2026-03-01T10:06:12Z"
}
```

**WebSocket send message frame**:
```json
{
  "type": "send_message",
  "payload": {
    "conversationId": 9001,
    "content": "Deploy lên staging rồi nhé!",
    "type": "TEXT",
    "clientMessageId": "client-uuid-abc-123"
  }
}
```

**WebSocket new message push**:
```json
{
  "type": "new_message",
  "payload": {
    "messageId": 7185492039184713780,
    "conversationId": 9001,
    "senderId": 1000,
    "senderName": "Tran Van A",
    "content": "Deploy lên staging rồi nhé!",
    "type": "TEXT",
    "createdAt": "2026-03-01T10:05:00Z"
  }
}
```

### Error Response Format
```json
{
  "timestamp": "2026-03-01T10:00:00Z",
  "status": 403,
  "error": "Forbidden",
  "code": "CHAT_NOT_MEMBER",
  "message": "You are not a member of this conversation",
  "path": "/api/v1/conversations/9001/messages"
}
```

### Pagination Strategy
- **Cursor-based** (dùng `message_id` Snowflake làm cursor) thay vì offset-based
- Lý do: offset-based bị hiệu suất kém khi offset lớn (`OFFSET 100000`); cursor-based luôn O(1) vì query `WHERE message_id < cursor LIMIT N` trên Cassandra clustering key
- Parameters: `before` (cursor), `limit` (default 20, max 100)
- Filtering support: `type` (TEXT/IMAGE/FILE), `senderId`, `fromTs`, `toTs`
- Sorting support: mặc định `message_id DESC` (newest-first), hỗ trợ `ASC` cho export/history replay

### API Versioning
- Path-based: `/api/v1/...`
- Deprecation policy: version cũ được hỗ trợ thêm 6 tháng sau khi version mới ra mắt
- Dual-run period: 3 tháng overlap

## 8. 🗄️ Data Modeling

### Database Schema — PostgreSQL (Users, Groups, Metadata)

```sql
-- Users table
CREATE TABLE users (
    id              BIGINT          PRIMARY KEY,  -- Snowflake ID
    username        VARCHAR(50)     NOT NULL UNIQUE,
    email           VARCHAR(255)    NOT NULL UNIQUE,
    password_hash   VARCHAR(255)    NOT NULL,
    display_name    VARCHAR(100)    NOT NULL,
    avatar_url      VARCHAR(500),
    status_message  VARCHAR(200),
    created_at      TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP       NOT NULL DEFAULT NOW()
);

-- Conversations (1-1 and group)
CREATE TABLE conversations (
    id              BIGINT          PRIMARY KEY,  -- Snowflake ID
    type            VARCHAR(10)     NOT NULL CHECK (type IN ('DIRECT', 'GROUP')),
    name            VARCHAR(100),       -- NULL for DIRECT, required for GROUP
    avatar_url      VARCHAR(500),
    created_by      BIGINT          NOT NULL REFERENCES users(id),
    created_at      TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP       NOT NULL DEFAULT NOW()
);

-- Conversation members (junction table)
CREATE TABLE conversation_members (
    conversation_id         BIGINT      NOT NULL REFERENCES conversations(id),
    user_id                 BIGINT      NOT NULL REFERENCES users(id),
    role                    VARCHAR(10) NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('ADMIN', 'MEMBER')),
    joined_at               TIMESTAMP   NOT NULL DEFAULT NOW(),
    last_read_message_id    BIGINT,         -- Snowflake ID of last read message
    muted_until             TIMESTAMP,
    notifications_enabled   BOOLEAN     NOT NULL DEFAULT TRUE,
    PRIMARY KEY (conversation_id, user_id)
);

-- User contacts / friends
CREATE TABLE user_contacts (
    user_id         BIGINT      NOT NULL REFERENCES users(id),
    contact_user_id BIGINT      NOT NULL REFERENCES users(id),
    nickname        VARCHAR(100),
    blocked         BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMP   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, contact_user_id)
);

-- Device tokens for push notifications
CREATE TABLE device_tokens (
    id          BIGINT          PRIMARY KEY,
    user_id     BIGINT          NOT NULL REFERENCES users(id),
    platform    VARCHAR(10)     NOT NULL CHECK (platform IN ('IOS', 'ANDROID', 'WEB')),
    token       VARCHAR(500)    NOT NULL,
    active      BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_device_tokens_user ON device_tokens(user_id) WHERE active = TRUE;
```

### Database Schema — Cassandra (Messages)

```sql
-- Messages table (primary message store)
-- Partition key: conversation_id → all messages of a conversation co-located
-- Clustering key: message_id DESC → newest messages first
CREATE TABLE messages (
    conversation_id     BIGINT,
    message_id          BIGINT,         -- Snowflake ID (time-sortable)
    sender_id           BIGINT,
    content             TEXT,
    type                TEXT,           -- TEXT, IMAGE, VIDEO, FILE, SYSTEM
    media_url           TEXT,
    reply_to_message_id BIGINT,
    created_at          TIMESTAMP,
    deleted_at          TIMESTAMP,
    PRIMARY KEY (conversation_id, message_id)
) WITH CLUSTERING ORDER BY (message_id DESC)
  AND compaction = {'class': 'LeveledCompactionStrategy'}
  AND default_time_to_live = 63072000
  AND gc_grace_seconds = 864000;

-- default_time_to_live = 63072000 seconds = 2 years [C5]
-- LeveledCompaction: phù hợp read-heavy per partition (load history)
```

> 💡 **Tại sao tách messages ra Cassandra thay vì dùng PostgreSQL?**
> Messages là write-heavy workload (115K peak QPS `[C1]`), query pattern cố định (`WHERE conversation_id = ? ORDER BY message_id DESC LIMIT N`), và data volume lớn (146TB/year `[C5]`). Cassandra wide-column model với partition key = conversation_id cho phép tất cả messages của 1 conversation nằm trên cùng partition → sequential read, rất hiệu quả. PostgreSQL handle metadata (users, groups) cần ACID + flexible queries.

### ER Diagram

```mermaid
erDiagram
    USERS {
        bigint id PK
        varchar username UK
        varchar email UK
        varchar password_hash
        varchar display_name
        varchar avatar_url
        varchar status_message
        timestamp created_at
        timestamp updated_at
    }

    CONVERSATIONS {
        bigint id PK
        varchar type
        varchar name
        varchar avatar_url
        bigint created_by FK
        timestamp created_at
        timestamp updated_at
    }

    CONVERSATION_MEMBERS {
        bigint conversation_id PK_FK
        bigint user_id PK_FK
        varchar role
        timestamp joined_at
        bigint last_read_message_id
        timestamp muted_until
        boolean notifications_enabled
    }

    MESSAGES {
        bigint conversation_id PK
        bigint message_id PK
        bigint sender_id
        text content
        text type
        text media_url
        bigint reply_to_message_id
        timestamp created_at
        timestamp deleted_at
    }

    USER_CONTACTS {
        bigint user_id PK_FK
        bigint contact_user_id PK_FK
        varchar nickname
        boolean blocked
        timestamp created_at
    }

    DEVICE_TOKENS {
        bigint id PK
        bigint user_id FK
        varchar platform
        varchar token
        boolean active
        timestamp created_at
    }

    USERS ||--o{ CONVERSATIONS : "creates"
    USERS ||--o{ CONVERSATION_MEMBERS : "joins"
    CONVERSATIONS ||--o{ CONVERSATION_MEMBERS : "has members"
    CONVERSATIONS ||--o{ MESSAGES : "contains"
    USERS ||--o{ MESSAGES : "sends"
    USERS ||--o{ USER_CONTACTS : "has contacts"
    USERS ||--o{ DEVICE_TOKENS : "has devices"
```

### Indexing Strategy

| Index | Table | Columns | Loại | Query Pattern phục vụ |
|---|---|---|---|---|
| `idx_conv_members_user` | conversation_members | (user_id) | B-tree | List conversations cho 1 user |
| `idx_conv_updated` | conversations | (updated_at DESC) | B-tree | Sort conversations theo tin nhắn mới nhất |
| `idx_device_tokens_user` | device_tokens | (user_id) WHERE active=TRUE | Partial | Lấy device tokens cho push notification |
| `idx_contacts_blocked` | user_contacts | (user_id) WHERE blocked=TRUE | Partial | Check block status nhanh |
| Cassandra partition index | messages | (conversation_id) | Partition key | Load messages by conversation |
| Cassandra clustering | messages | (message_id DESC) | Clustering | Order messages by time (newest first) |

### Partitioning / Sharding Strategy

**Cassandra (messages)**:
- **Partition key**: `conversation_id` → tất cả messages cùng conversation nằm trên 1 partition
- **Partition size target**: < 100MB per partition (Cassandra recommendation)
  - Ước tính: conversation trung bình 10,000 messages × 200B = 2MB → rất tốt
  - Conversation sôi nổi 500,000 messages × 200B = 100MB → chấp nhận được
  - Nếu vượt 100MB → split bằng composite key `(conversation_id, time_bucket)`
- **Replication factor**: 3 (across 3 racks/AZs)
- **Consistency**: Write = `LOCAL_QUORUM` (2/3), Read = `LOCAL_ONE` (1/3) cho history

**PostgreSQL (metadata)**:
- Ở scale 50M users, PostgreSQL single instance vẫn handle được metadata (users + conversations + members)
- Nếu cần scale: horizontal partitioning by `user_id` hash (application-level routing)
- Read replicas cho read-heavy queries (list conversations, search users)

### Data Retention Policy

| Data Type | Retention | Strategy |
|---|---|---|
| Text messages | 2 years | Cassandra TTL `default_time_to_live = 63072000` `[C5]` |
| Media files (S3) | 1 year hot, archive after | S3 Intelligent-Tiering → Glacier Deep Archive sau 1 năm `[C6]` |
| User profiles | Indefinite | PostgreSQL, soft delete |
| Push notification logs | 30 days | Kafka topic retention 7 days + ELK 30 days |
| Analytics events | 1 year detail → monthly rollup | Kafka → S3 raw (1 year) → Athena monthly rollup → delete raw |

## 9. ⚙️ Manager Classes / Services

### Service Decomposition

| Service | Vai trò | Scale independently |
|---|---|---|
| WS Gateway | WebSocket connection management, authentication, message routing | Yes — scale theo concurrent connections `[C4]` |
| Chat Service | Message processing, persistence, delivery orchestration | Yes — scale theo write QPS `[C1]` |
| User Service | User CRUD, authentication, contacts | Yes — scale theo user management traffic |
| Group Service | Group lifecycle, membership management | Low traffic — 2 replicas đủ |
| Presence Service | Online status, heartbeat processing, last seen | Yes — scale theo presence updates |
| Notification Service | Push notification delivery (FCM/APNs) | Yes — scale theo offline message volume |
| Media Service | File upload/download, thumbnail generation | Yes — scale theo media traffic |

### Core Service Classes & Responsibilities

| Class | Annotation | Responsibility |
|---|---|---|
| `ChatService` | `@Service` | Orchestrate message flow: validate, dedup, persist, deliver |
| `MessageDeliveryService` | `@Service` | Route message tới recipient's WS Gateway, handle delivery status |
| `SnowflakeIdGenerator` | `@Component` | Generate unique, time-sortable 64-bit message IDs |
| `WebSocketSessionRegistry` | `@Component` | Track user ↔ WS Gateway mapping trong Redis |
| `PresenceManager` | `@Service` | Process heartbeats, manage online/offline status |
| `GroupMembershipService` | `@Service` | Manage group members, check permissions |
| `MessageCacheService` | `@Service` | Multi-layer cache cho recent messages |
| `KafkaEventPublisher` | `@Component` | Publish domain events (message.sent, user.online, ...) |

### Backend Code Example (Java / Spring Boot)

**ChatService.java — Core message processing**:
```java
@Service
@RequiredArgsConstructor
public class ChatService {

    private final CassandraMessageRepository messageRepository;
    private final MessageDeliveryService deliveryService;
    private final SnowflakeIdGenerator idGenerator;
    private final GroupMembershipService membershipService;
    private final KafkaEventPublisher eventPublisher;
    private final RedisTemplate<String, String> redisTemplate;

    @Value("${chat.dedup.ttl-seconds:300}")
    private int dedupTtlSeconds;

    public MessageResponse sendMessage(Long senderId, SendMessageRequest request) {
        // 1. Deduplication check
        String dedupKey = "dedup:" + request.getClientMessageId();
        Boolean isNew = redisTemplate.opsForValue()
                .setIfAbsent(dedupKey, "PENDING", Duration.ofSeconds(dedupTtlSeconds));
        if (Boolean.FALSE.equals(isNew)) {
            String existingMessageId = redisTemplate.opsForValue().get(dedupKey);
            if (existingMessageId != null && !"PENDING".equals(existingMessageId)) {
                long messageId = Long.parseLong(existingMessageId);
                return messageRepository.findById(request.getConversationId(), messageId)
                        .map(this::toResponse)
                        .orElseThrow(() -> new ConflictException("Duplicate message not found"));
            }
            throw new ConflictException("Duplicate message being processed");
        }

        // 2. Validate membership
        if (!membershipService.isMember(request.getConversationId(), senderId)) {
            throw new ForbiddenException("Not a member of this conversation");
        }

        // 3. Generate Snowflake ID
        long messageId = idGenerator.nextId();

        // 4. Build and persist message
        Message message = Message.builder()
                .conversationId(request.getConversationId())
                .messageId(messageId)
                .senderId(senderId)
                .content(request.getContent())
                .type(request.getType())
                .mediaUrl(request.getMediaUrl())
                .replyToMessageId(request.getReplyToMessageId())
                .createdAt(Instant.now())
                .build();

        messageRepository.save(message);
        redisTemplate.opsForValue()
                .set(dedupKey, String.valueOf(messageId), Duration.ofSeconds(dedupTtlSeconds));

        // 5. Publish event for async processing (notifications, analytics)
        eventPublisher.publish("message.sent", MessageSentEvent.from(message));

        // 6. Deliver to online recipients
        deliveryService.deliverAsync(message);

        return toResponse(message);
    }

    public CursorPage<MessageResponse> getHistory(
            Long userId, Long conversationId, Long beforeCursor, int limit) {

        if (!membershipService.isMember(conversationId, userId)) {
            throw new ForbiddenException("Not a member of this conversation");
        }

        List<Message> messages = messageRepository.findByConversationId(
                conversationId, beforeCursor, limit + 1);

        boolean hasMore = messages.size() > limit;
        if (hasMore) {
            messages = messages.subList(0, limit);
        }

        Long nextCursor = hasMore ? messages.get(messages.size() - 1).getMessageId() : null;
        List<MessageResponse> responses = messages.stream()
                .map(this::toResponse)
                .toList();

        return new CursorPage<>(responses, nextCursor, hasMore);
    }

    private MessageResponse toResponse(Message message) {
        return MessageResponse.builder()
                .messageId(message.getMessageId())
                .conversationId(message.getConversationId())
                .senderId(message.getSenderId())
                .content(message.getContent())
                .type(message.getType())
                .mediaUrl(message.getMediaUrl())
                .replyToMessageId(message.getReplyToMessageId())
                .createdAt(message.getCreatedAt())
                .build();
    }
}
```

**MessageDeliveryService.java — Route messages to recipients**:
```java
@Service
@RequiredArgsConstructor
@Slf4j
public class MessageDeliveryService {

    private final WebSocketSessionRegistry sessionRegistry;
    private final WsGatewayGrpcClient wsGatewayClient;
    private final GroupMembershipService membershipService;

    @Async("deliveryExecutor")
    public void deliverAsync(Message message) {
        List<Long> recipientIds = getRecipientIds(message);

        for (Long recipientId : recipientIds) {
            try {
                deliverToUser(recipientId, message);
            } catch (Exception e) {
                log.warn("Failed to deliver message {} to user {}", 
                         message.getMessageId(), recipientId, e);
                // Offline users will receive via push notification (Kafka consumer)
            }
        }
    }

    private void deliverToUser(Long userId, Message message) {
        SessionInfo session = sessionRegistry.getSession(userId);
        if (session == null) {
            return; // User offline, handled by Notification Service
        }

        wsGatewayClient.pushMessage(session.getServerId(), userId, message);
    }

    private List<Long> getRecipientIds(Message message) {
        List<Long> members = membershipService.getMemberIds(message.getConversationId());
        return members.stream()
                .filter(id -> !id.equals(message.getSenderId()))
                .toList();
    }
}
```

**SnowflakeIdGenerator.java**:
```java
@Component
public class SnowflakeIdGenerator {

    private static final long CUSTOM_EPOCH = 1704067200000L; // 2024-01-01T00:00:00Z
    private static final int WORKER_ID_BITS = 10;
    private static final int SEQUENCE_BITS = 12;

    private final long workerId;
    private long lastTimestamp = -1L;
    private long sequence = 0L;

    public SnowflakeIdGenerator(@Value("${snowflake.worker-id}") long workerId) {
        if (workerId < 0 || workerId >= (1L << WORKER_ID_BITS)) {
            throw new IllegalArgumentException("Worker ID must be between 0 and 1023");
        }
        this.workerId = workerId;
    }

    public synchronized long nextId() {
        long currentTimestamp = System.currentTimeMillis() - CUSTOM_EPOCH;

        if (currentTimestamp == lastTimestamp) {
            sequence = (sequence + 1) & ((1L << SEQUENCE_BITS) - 1);
            if (sequence == 0) {
                currentTimestamp = waitNextMillis(currentTimestamp);
            }
        } else {
            sequence = 0;
        }

        lastTimestamp = currentTimestamp;

        return (currentTimestamp << (WORKER_ID_BITS + SEQUENCE_BITS))
                | (workerId << SEQUENCE_BITS)
                | sequence;
    }

    private long waitNextMillis(long currentTimestamp) {
        while (currentTimestamp <= lastTimestamp) {
            currentTimestamp = System.currentTimeMillis() - CUSTOM_EPOCH;
        }
        return currentTimestamp;
    }
}
```

### Frontend Code Example (React + TypeScript)

**ChatRoom.tsx — Core chat component**:
```tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { chatApi } from '../api/chatApi';
import { Message, SendMessageRequest } from '../types/chat';
import { v4 as uuidv4 } from 'uuid';

interface ChatRoomProps {
  conversationId: number;
  currentUserId: number;
}

export const ChatRoom: React.FC<ChatRoomProps> = ({ conversationId, currentUserId }) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { sendWsMessage, lastMessage } = useWebSocket();

  // Load message history (cursor-based pagination)
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['messages', conversationId],
    queryFn: ({ pageParam }) =>
      chatApi.getMessages(conversationId, { before: pageParam, limit: 20 }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as number | undefined,
  });

  const messages = data?.pages.flatMap((page) => page.messages).reverse() ?? [];

  // Handle incoming WebSocket messages
  useEffect(() => {
    if (lastMessage?.type === 'new_message' &&
        lastMessage.payload.conversationId === conversationId) {
      // Optimistic: append to local messages
    }
  }, [lastMessage, conversationId]);

  // Send message
  const handleSend = useCallback(() => {
    if (!inputText.trim()) return;

    const request: SendMessageRequest = {
      conversationId,
      content: inputText.trim(),
      type: 'TEXT',
      clientMessageId: uuidv4(),
    };

    sendWsMessage({ type: 'send_message', payload: request });
    setInputText('');
  }, [inputText, conversationId, sendWsMessage]);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="chat-room">
      <div className="messages-container" onScroll={(e) => {
        if (e.currentTarget.scrollTop === 0 && hasNextPage) {
          fetchNextPage();
        }
      }}>
        {isFetchingNextPage && <div className="loading">Loading...</div>}
        {messages.map((msg) => (
          <div
            key={msg.messageId}
            className={`message ${msg.senderId === currentUserId ? 'sent' : 'received'}`}
          >
            <span className="sender">{msg.senderName}</span>
            <p className="content">{msg.content}</p>
            <span className="time">
              {new Date(msg.createdAt).toLocaleTimeString()}
            </span>
            <span className="status">{msg.status}</span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-container">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Nhập tin nhắn..."
        />
        <button onClick={handleSend}>Gửi</button>
      </div>
    </div>
  );
};
```

### Service Communication Patterns

| From | To | Pattern | Protocol |
|---|---|---|---|
| WS Gateway | Chat Service | Sync (request-reply) | gRPC |
| Chat Service | Cassandra | Sync (write/read) | CQL Driver |
| Chat Service | Redis | Sync (cache/lookup) | Redis client |
| Chat Service | Kafka | Async (publish) | Kafka Producer |
| Chat Service | WS Gateway | Sync (push delivery) | gRPC |
| Kafka | Notification Service | Async (consume) | Kafka Consumer |
| Notification Service | FCM/APNs | Async (fire-and-forget) | HTTP/2 |
| Client | Media Service | Sync (upload/download) | REST |
| Media Service | S3 | Sync (put/get) | AWS SDK |

## 10. 🏛️ Architecture Design

- **Pattern**: Microservices architecture, event-driven cho async flows
- **Critical path optimization**: Message delivery path (WS Gateway → Chat Service → WS Gateway) tối ưu cho low latency (<200ms p95); non-critical paths (analytics, notification) xử lý async qua Kafka

### Architecture Diagram

```mermaid
flowchart TB
    subgraph Internet
        Client["Client Apps - Web + Mobile"]
    end

    subgraph AWS_Edge["AWS Edge"]
        Route53["Route 53 - DNS"]
        CloudFront["CloudFront - Media CDN"]
        WAF["WAF + Shield"]
    end

    subgraph AWS_VPC["AWS VPC - ap-southeast-1"]
        NLB["NLB - WebSocket TCP L4"]
        ALB["ALB - REST API HTTP L7"]

        subgraph EKS["Amazon EKS Cluster"]
            WSG["WS Gateway - 300 pods C4"]
            CS["Chat Service - 6~30 pods C1"]
            US["User Service - 4 pods"]
            GS["Group Service - 2 pods"]
            PS["Presence Service - 4 pods"]
            NS["Notification Svc - 4 pods"]
            MS["Media Service - 4 pods"]
        end

        subgraph DataStores["Data Stores"]
            Cassandra["Cassandra 12 nodes - messages C1 C5"]
            RDS["RDS PostgreSQL Multi-AZ - users, groups"]
            Redis["ElastiCache Redis 60GB - C7"]
        end

        MSK["Amazon MSK 6 brokers - Kafka C2"]
        S3["S3 media storage - C6"]
        SNS_Push["SNS - push notifications"]
    end

    Client --> Route53
    Route53 --> NLB
    Route53 --> CloudFront
    CloudFront --> ALB
    CloudFront --> S3
    WAF --> NLB
    WAF --> ALB

    NLB --> WSG
    ALB --> US
    ALB --> GS
    ALB --> MS

    WSG -->|gRPC| CS
    CS --> Cassandra
    CS --> Redis
    CS --> MSK
    CS -->|gRPC push| WSG
    US --> RDS
    GS --> RDS
    PS --> Redis
    MS --> S3
    MSK --> NS
    NS --> SNS_Push

    CS -.->|metrics| Prometheus["Prometheus + Grafana"]
    WSG -.->|metrics| Prometheus
    CS -.->|logs| ELK["ELK Stack"]
    CS -.->|traces| XRay["X-Ray"]
```

### Scaling Strategy

| Component | Metric | Min | Max | Trigger |
|---|---|---|---|---|
| WS Gateway | Concurrent connections `[C4]` | 100 | 300 | connections_per_pod > 40K |
| Chat Service | CPU utilization `[C1]` | 6 | 30 | cpu > 60% for 2 min |
| User Service | Request rate | 2 | 10 | rps > 500 per pod |
| Presence Service | Redis ops/s | 2 | 10 | ops > 10K per pod |
| Notification Service | Kafka consumer lag | 2 | 20 | lag > 10,000 messages |
| Media Service | CPU (thumbnail gen) | 2 | 10 | cpu > 70% for 3 min |
| Cassandra | Disk usage, read/write latency `[C1][C3]` | 12 nodes | 24 nodes | Manual scale khi disk > 70% hoặc p99 > 50ms |
| Redis | Memory usage `[C7]` | 4 nodes | 8 nodes | memory > 80% |

### Caching Strategy

**Multi-layer caching**:

| Layer | Technology | Cached Data | TTL | Eviction |
|---|---|---|---|---|
| L1 — CDN | CloudFront | Media files (images, files) | 24h | Invalidation API khi delete |
| L2 — Application | Redis `[C7]` | Recent messages, conversation list, online status, session routing | 5 min (messages), 60s (status) | LRU |
| L3 — DB | Cassandra OS page cache `[C3]` | Hot partitions (frequently accessed conversations) | OS-managed | LRU |

**Cache invalidation**:
- Messages: write-through (write to cache khi message created, TTL 5 min)
- Online status: TTL-based (60s heartbeat refresh)
- Conversation list: invalidate on new message (Kafka consumer updates cache)
- Unread counts: atomic increment trong Redis (INCRBY)

### Load Balancing / Gateway

| Component | Type | Routing |
|---|---|---|
| NLB | Network Load Balancer (L4 TCP) | WebSocket connections — sticky sessions based on source IP (giữ connection persistent), sizing theo peak throughput `[C8]` |
| ALB | Application Load Balancer (L7 HTTP) | REST API — round-robin, path-based routing |
| Istio Service Mesh | Sidecar proxy | Internal gRPC — client-side load balancing, mTLS, circuit breaker |

> 📌 Dùng **NLB** (không phải ALB) cho WebSocket vì NLB hoạt động ở L4 TCP, không timeout idle connections, handle 15M concurrent connections `[C4]` và peak egress throughput `[C8]` hiệu quả hơn.

### Resilience Patterns

| Pattern | Áp dụng | Config |
|---|---|---|
| **Circuit Breaker** | Chat Service → Cassandra, Chat Service → WS Gateway | Failure threshold: 50% trong 10s, half-open sau 30s. Fallback: queue message trong Kafka |
| **Retry with Backoff** | gRPC calls (WS Gateway → Chat Service) | Max 3 retries, backoff: 100ms, 200ms, 400ms + jitter |
| **Bulkhead** | Thread pools cho delivery vs history | Delivery: 200 threads, History: 100 threads — isolate để history load không ảnh hưởng delivery |
| **Timeout** | Cassandra write: 5s, Redis: 1s, gRPC: 3s | Timeout per dependency, không cascade |
| **Graceful Degradation** | Redis down | Disable online status, disable message cache → fallback query Cassandra trực tiếp. Messaging vẫn hoạt động |
| **Request Coalescing** | Cache miss đồng thời cho cùng conversation | Singleflight pattern: chỉ 1 request tới DB, các request khác wait và share result |

## 11. 🧪 Testing Strategy

| Level | Framework | Scope | Coverage Target |
|---|---|---|---|
| **Unit Testing** | JUnit 5 + Mockito | Service logic (ChatService, DeliveryService, SnowflakeIdGenerator) | ≥ 85% line coverage |
| **Integration Testing** | Spring Boot Test + Testcontainers | Cassandra queries, Redis operations, Kafka produce/consume | Tất cả repository methods + event flows |
| **API Contract Testing** | Spring Cloud Contract | WS Gateway ↔ Chat Service gRPC contract | Tất cả gRPC service definitions |
| **Load Testing** | Gatling + WebSocket plugin | Simulate 100K concurrent WS connections, 10K msg/s | p95 delivery < 200ms, 0% message loss |
| **Chaos Engineering** | Chaos Mesh (K8s) | Kill WS Gateway pods, Cassandra node failure, Redis failover | System recovers < 30s, no message loss |
| **E2E Testing** | Playwright (web), Detox (mobile) | Send message → receive → read receipt flow | Critical user flows pass |

**Load test kịch bản cụ thể**:
1. **Sustained load**: 50K concurrent connections, 5K messages/s trong 30 phút → assert p95 < 200ms
2. **Spike test**: Ramp từ 10K → 100K connections trong 2 phút → assert no connection drops
3. **Failover**: Kill 1 WS Gateway pod during load → assert clients reconnect < 5s, no messages lost

## 12. 🔒 Security

- **Authentication**: JWT RS256 (asymmetric), access token 1h, refresh token 30 days. WebSocket authenticate 1 lần khi handshake.
- **Authorization**: Owner-based cho conversations (chỉ members mới gửi/đọc), RBAC cho group (ADMIN vs MEMBER).
- **TLS**: Public endpoints → HTTPS (TLS 1.3) qua NLB/ALB. Internal → mTLS via Istio service mesh.
- **Input validation**:
  - Message content: max 4KB, sanitize HTML/scripts
  - Username: regex `^[a-zA-Z0-9_]{3,50}$`
  - Media upload: validate MIME type, max 25MB, virus scan (ClamAV)
- **DDoS/Bot protection**: AWS WAF rules (rate limit 1000 req/min per IP), Shield Standard. WebSocket: rate limit messages per connection (60/min free, 300/min premium).
- **Data protection**: Encryption at rest — RDS (AES-256 via KMS), S3 (SSE-S3), Cassandra (transparent encryption). Encryption in transit — TLS everywhere.
- **Secrets management**: AWS Secrets Manager cho DB credentials, API keys. Rotated mỗi 90 ngày.
- **Compliance**: Tuân thủ GDPR (right to access/delete dữ liệu user), PDPA cho SEA region; PII tối thiểu hóa trong logs, data residency tại `ap-southeast-1`.
- **OWASP Top 10 mitigations**:
  - Injection: parameterized queries (Spring Data, CQL prepared statements)
  - Broken Authentication: JWT với short TTL + refresh rotation
  - SSRF: validate media URLs, block internal IP ranges
  - XSS: sanitize message content trước render (DOMPurify on client)

## 13. 📊 Monitoring & Logging

### Key Metrics

| Nhóm | Metrics |
|---|---|
| **Latency** | Message delivery p50/p95/p99, History load p95, WebSocket handshake time |
| **Traffic** | Active WebSocket connections, Messages sent/s, Messages delivered/s, API RPS |
| **Errors** | Delivery failure rate, WebSocket disconnect rate, 4xx/5xx rate, Kafka consumer error rate |
| **Saturation** | WS Gateway connection count vs capacity, Cassandra disk usage, Redis memory usage, Kafka consumer lag, thread pool utilization |

### Logging Strategy
- **Structured JSON** logs: `{timestamp, level, service, traceId, requestId, userId, conversationId, messageId, action, duration_ms, error?}`
- Log levels: `INFO` cho message flow milestones, `WARN` cho delivery retries / cache miss, `ERROR` cho persist failure / connection errors
- Centralized logging: Filebeat → Logstash → OpenSearch (AWS managed)
- Retention: 7 days hot (OpenSearch), 30 days warm, 90 days cold (S3)

### SLI / SLO / Error Budget

| SLI | SLO | Error Budget |
|---|---|---|
| Message delivery success rate | 99.99% (≤ 4.3 min downtime/month) | 0.01% → ~200K failed deliveries/day trên 2B messages |
| Delivery latency p99 | < 500ms | — |
| History load latency p95 | < 100ms | — |
| WebSocket connection success rate | 99.95% | 0.05% → ~7,500 failed connections/day |

**Error budget policy**: Khi error budget cạn 80% → freeze feature deployments, focus reliability fixes. Khi cạn 100% → incident review mandatory.

### Alerting & Incident Response

| Alert | Condition | Severity | Action |
|---|---|---|---|
| High delivery latency | p95 > 300ms trong 5 phút | P2 | Check Cassandra latency, Redis connectivity |
| Delivery failure spike | Failure rate > 1% trong 2 phút | P1 | Page on-call, check WS Gateway health, Cassandra availability |
| WebSocket connection drop | Disconnect rate > 5% trong 1 phút | P1 | Check NLB health, WS Gateway pod status |
| Kafka consumer lag | Lag > 50,000 trong 5 phút | P2 | Scale Notification Service consumers |
| Cassandra disk > 80% | Per-node disk usage | P3 | Plan capacity expansion, check compaction |
| Redis memory > 85% | Cluster memory utilization | P2 | Check eviction rate, consider scaling cluster |

**Distributed tracing**: OpenTelemetry SDK → AWS X-Ray. Trace toàn bộ message delivery path: Client → WS Gateway → Chat Service → Cassandra + Redis + Kafka → WS Gateway → Recipient.

**Runbook outline**:
1. Detect: Alert firing + dashboard correlation (latency, error, saturation)
2. Triage: Xác định blast radius (single service vs toàn hệ thống), gán incident commander
3. Mitigate: Rollback canary/scale up component lỗi/enable feature flag kill-switch
4. Postmortem: RCA trong 48h, action items có owner + due date

## 14. 🔧 Maintenance

- **CI/CD pipeline**: `build → unit test → integration test (Testcontainers) → security scan (Snyk) → build Docker image → push ECR → deploy staging → smoke test → canary production`
- **Database migration**:
  - PostgreSQL: Flyway, backward-compatible migrations only (add column with default, never drop column in same release)
  - Cassandra: Schema changes via `cqlsh` scripts, versioned in Git. No ALTER DROP (always add new columns)
- **Dependency management**: Renovate bot, auto-update minor/patch versions, manual review major versions
- **Feature flags**: LaunchDarkly (hoặc self-hosted Unleash). Use cases: canary rollout new delivery algorithm, A/B test UI features, kill-switch cho media upload
- **Documentation**: OpenAPI 3.0 auto-generate từ Spring Boot annotations, gRPC proto files versioned, ADR (Architecture Decision Records) cho major decisions
- **Technical debt**: 15% sprint capacity allocated, tracked trong Jira "Tech Debt" epic. Review cadence: monthly

## 15. 🚀 Deployment Plans

### Deployment Strategy
| Service | Strategy | Lý do |
|---|---|---|
| WS Gateway | **Rolling update** (maxUnavailable: 10%) | Persistent connections — rolling giảm reconnection storm. Connection draining 30s trước khi terminate pod |
| Chat Service | **Canary** (5% → 25% → 50% → 100%) | Core service, cần validate latency/error rate trước full rollout |
| Other services | **Rolling update** (maxUnavailable: 25%) | Stateless, ít risk |

### Rollback Plan
- `kubectl rollout undo deployment/<service>` — automated rollback khi canary metrics vượt threshold
- DB migration rollback: Flyway `undo` scripts cho PostgreSQL; Cassandra backward-compatible nên không cần rollback
- Feature flag kill-switch: disable feature trong < 1 phút, không cần redeploy

### IaC (Terraform Modules)
| Module | Resources |
|---|---|
| `network` | VPC, subnets (3 AZ), NAT Gateway, security groups |
| `eks` | EKS cluster, node groups (mixed instances), IRSA |
| `cassandra` | EC2 instances (i3.2xlarge), EBS volumes, security groups |
| `rds` | RDS PostgreSQL Multi-AZ, parameter groups, subnet groups |
| `elasticache` | Redis cluster, replication groups, parameter groups |
| `msk` | MSK cluster, configuration, security |
| `s3` | Buckets (media, logs, backups), lifecycle policies |
| `monitoring` | CloudWatch dashboards, alarms, SNS topics |

### Artifacts
- Docker images build bằng multi-stage (`builder` + `runtime`) để giảm image size và CVE surface
- Helm charts riêng cho từng service (`ws-gateway`, `chat-service`, `presence-service`, `notification-service`)
- Versioning artifacts theo Git SHA + semantic version (`chat-service:1.8.0-<sha>`)
- OCI registry: Amazon ECR, retention policy giữ 30 bản release gần nhất

### Auto-scaling
- **HPA**: WS Gateway (connections), Chat Service (CPU), Notification Service (Kafka lag)
- **VPA**: User Service, Group Service (right-size resources)
- **Cluster Autoscaler**: EKS node groups min=10, max=100 nodes
- **Cassandra**: Manual horizontal scale (add nodes to ring, run `nodetool repair`)

### Pre-prod Gate
- Bắt buộc pass load test: tối thiểu 10K msg/s, p95 delivery < 200ms, error rate < 0.1%
- Bắt buộc pass smoke test E2E: send/receive/read-receipt/media upload
- Security gate: SAST/SCA không còn high severity chưa waive
- Operational gate: dashboard + alert + runbook cho service mới phải có trước production

### Multi-region (Future)
- **Active-passive**: Primary region `ap-southeast-1`, DR region `ap-northeast-1`
- Cassandra: multi-DC replication (NetworkTopologyStrategy, RF=3 per DC)
- PostgreSQL: RDS cross-region read replica, promote on failover
- Route53 health check → automatic failover DNS
- RPO < 1 minute, RTO < 5 minutes

## 16. ⏱️ Effort Estimation

### Phase Breakdown & Timeline

| Phase | Duration | Deliverables |
|---|---|---|
| Discovery & Design | 3 tuần | System design doc, API specs, data model, tech spike (WebSocket + Cassandra) |
| MVP (1-1 chat) | 6 tuần | WS Gateway, Chat Service, User Service, basic web client, Cassandra + Redis setup |
| Group Chat & Features | 4 tuần | Group Service, group messaging, typing indicator, read receipts |
| Media & Notifications | 3 tuần | Media Service, Notification Service, FCM/APNs integration, file upload |
| Hardening | 3 tuần | Load testing, chaos engineering, security audit, monitoring dashboards |
| Production Readiness | 2 tuần | IaC (Terraform), CI/CD pipeline, runbooks, on-call setup |
| **Total** | **~21 tuần (~5 tháng)** | |

### Team Composition

| Role | Số lượng | Responsibilities |
|---|---|---|
| Tech Lead | 1 | Architecture decisions, code review, cross-team coordination |
| Backend Engineer (Senior) | 3 | Chat Service, WS Gateway, Presence Service, Cassandra |
| Backend Engineer (Mid) | 2 | User Service, Group Service, Notification Service, Media Service |
| Frontend Engineer | 2 | React web app, React Native mobile app |
| DevOps/SRE | 1 | Terraform, CI/CD, monitoring, Cassandra operations |
| QA Engineer | 1 | Test automation, load testing, chaos engineering |
| **Total** | **10 người** | |

### Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Cassandra operational complexity (team chưa có kinh nghiệm) | High | Tech spike 2 tuần trước MVP, training, thuê consultant nếu cần |
| WebSocket connection management at scale (15M connections) | High | Start với 1M connections MVP, stress test incremental, NLB testing sớm |
| Message ordering issues trong distributed system | Medium | Snowflake ID đảm bảo per-worker ordering, test edge cases (clock skew, network partition) |
| Kafka consumer lag gây delay notification | Medium | Monitor lag, auto-scale consumers, set max.poll.records hợp lý |
| Cost overrun do media storage growth (7.3PB/year) | Medium | S3 lifecycle policies sớm, compress media, set upload limits |

### Dependencies & Blockers
- AWS account setup + IAM permissions (DevOps team)
- FCM/APNs credentials (mobile team)
- Security review cho WebSocket authentication flow (security team)
- Cassandra licensing (nếu dùng DataStax Enterprise) hoặc chọn open-source Apache Cassandra

## 17. 💰 Cost Estimation & Optimization

### 17.1 Chi phí hàng tháng theo từng resource (AWS ap-southeast-1)

**Compute (EKS)**:
| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| EKS Control Plane | Managed | 1 | $73 | $73 | |
| WS Gateway nodes | c5.2xlarge (8 vCPU, 16GB) | 60 (at peak) | $250 | $15,000 | 300 pods × 50K conn `[C4]`, 5 pods/node |
| Chat Service nodes | c5.xlarge (4 vCPU, 8GB) | 8 | $125 | $1,000 | 6-30 pods `[C1]` |
| Other services nodes | m5.xlarge (4 vCPU, 16GB) | 10 | $140 | $1,400 | User, Group, Presence, Notif, Media |

**Database**:
| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| Cassandra (EC2) | i3.2xlarge (8 vCPU, 61GB, 1.9TB NVMe) | 12 | $450 | $5,400 | RF=3, 12 nodes `[C1][C5]` |
| RDS PostgreSQL | db.r6g.xlarge Multi-AZ | 1 | $800 | $800 | Users, groups metadata |
| ElastiCache Redis | r6g.2xlarge (52GB) | 4 | $550 | $2,200 | 60GB cluster `[C7]` |

**Message Queue**:
| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| MSK (Kafka) | kafka.m5.xlarge | 6 brokers | $300 | $1,800 | Handle delivery events `[C2]` |
| MSK storage | 500GB per broker | 6 | $50 | $300 | 7-day retention |

**Network/CDN**:
| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| NLB | Per LCU + hourly | 1 | $500 | $500 | WebSocket 15M conn `[C4]` |
| ALB | Per LCU + hourly | 1 | $200 | $200 | REST API |
| CloudFront | Data transfer | — | $500 | $500 | Media CDN `[C6]` |
| NAT Gateway | Per GB processed | 3 AZ | $200 | $600 | |

**Storage**:
| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| S3 (media) | Intelligent-Tiering | ~600TB (first year) | $0.023/GB | $13,800 | 20TB/day `[C6]` |
| S3 (logs, backups) | Standard | ~5TB | $0.023/GB | $115 | |

**Monitoring/Logging**:
| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| CloudWatch | Metrics + Logs | — | $300 | $300 | |
| Prometheus + Grafana | Self-hosted on EKS | 2 pods | — | $0 | Included in compute |
| OpenSearch (ELK) | m5.xlarge.search | 3 nodes | $250 | $750 | Centralized logging |

### 17.2 Tổng hợp cost theo giai đoạn

| Giai đoạn | Monthly Cost | Annual Cost | Ghi chú |
|---|---|---|---|
| **MVP** (1M DAU, 3M conn) | ~$8,000 | ~$96,000 | 20 WS nodes, 6 Cassandra nodes, smaller instances |
| **Growth** (10M DAU, avg traffic) | ~$22,000 | ~$264,000 | 100 WS pods, 12 Cassandra nodes, full Redis cluster |
| **Peak/Scale** (50M DAU, full) | ~$44,738 | ~$536,856 | 300 WS pods, 12+ Cassandra nodes, full MSK |

### 17.3 Cost Breakdown theo category

| Category | Monthly Cost (Peak) | % tổng |
|---|---|---|
| Compute (EKS nodes) | $17,473 | 39% |
| Storage (S3 media) | $13,915 | 31% |
| Database (Cassandra + RDS + Redis) | $8,400 | 19% |
| Message Queue (MSK) | $2,100 | 5% |
| Network (NLB + ALB + CDN + NAT) | $1,800 | 4% |
| Monitoring | $1,050 | 2% |
| **Total** | **~$44,738** | **100%** |

> 📌 **Storage (S3)** chiếm 31% cost — media storage là cost driver lớn nhất sau compute. Optimize media compression và lifecycle policies là ưu tiên #1.

### 17.4 Cost Optimization Strategies

| Strategy | Mô tả | Tiết kiệm ước tính | Trade-off |
|---|---|---|---|
| **Reserved Instances** (Cassandra, RDS) | RI 1 năm cho Cassandra EC2 + RDS | ~35% compute → ~$2,170/tháng | Commit 1 năm |
| **Spot Instances** (Notification, Media workers) | Spot cho stateless services | ~60% trên spot nodes → ~$840/tháng | Có thể bị reclaim, cần handle gracefully |
| **S3 Lifecycle** | Intelligent-Tiering → Glacier sau 6 tháng | ~40% storage sau year 1 → ~$5,520/tháng | Cold media access chậm hơn (restore time) |
| **Media compression** | Compress ảnh (WebP, 60% quality) trước upload | ~50% media storage → ~$6,900/tháng | Chất lượng ảnh giảm nhẹ |
| **WS Gateway right-sizing** | Tối ưu connections/pod lên 80K (Netty tuning) | Giảm từ 300 → 190 pods → ~$5,500/tháng | Cần perf testing kỹ |
| **CDN caching** | Cache media ở edge lâu hơn (7 days) | Giảm S3 egress → ~$200/tháng | Stale content nếu update |

### 17.5 Cost Projection (12 tháng)

| Tháng | Traffic estimate | Infra changes | Monthly Cost |
|---|---|---|---|
| 1-3 | 1M DAU (MVP) | Minimal setup | ~$8,000 |
| 4-6 | 5M DAU | Scale WS + Cassandra | ~$15,000 |
| 7-9 | 15M DAU | Add Redis nodes, scale MSK | ~$25,000 |
| 10-12 | 30M DAU | Full Cassandra cluster, more WS nodes | ~$35,000 |
| 13-18 | 50M DAU (target) | Full scale architecture | ~$45,000 |

> 📌 Inflection points: tháng 6 (cần thêm Cassandra nodes khi storage > 30TB), tháng 9 (cần upgrade Redis cluster khi cache > 40GB), tháng 12 (cần NLB capacity khi connections > 10M).

### 17.6 Cost Alerts & Governance

- **AWS Budget alerts**: 80% ($35,800), 100% ($44,738), 120% ($53,686) monthly budget
- **Review cadence**: Monthly cost review (DevOps + Tech Lead), quarterly deep-dive (full team)
- **Tagging strategy**: tags bắt buộc — `team`, `service`, `environment` (dev/staging/prod), `cost-center`
- **Anomaly detection**: AWS Cost Anomaly Detection enabled, alert khi daily cost tăng > 20% so với baseline
- **Resource cleanup**: Weekly automated check cho unused EBS volumes, idle EC2 instances, unattached ENIs
