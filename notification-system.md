# Notification System - System Design

## 1. 📋 Đề Bài (Problem Statement)

- Thiết kế hệ thống **Notification System** quy mô lớn cho nền tảng chia sẻ nội dung (như YouTube) kết hợp các sự kiện giao dịch, cho phép gửi hàng triệu thông báo đa kênh (**Push, Email, SMS, In-app**) mà không làm chậm hay ảnh hưởng đến ứng dụng chính.
- Khi một creator có 1 triệu đến 10 triệu subscribers đăng video mới, hệ thống phải tách hoàn toàn quá trình lưu video khỏi quá trình mở rộng danh sách người nhận (fan-out) và giao hàng, đồng thời bảo đảm các thông báo khẩn cấp như OTP đăng nhập hoặc cảnh báo bảo mật không bao giờ bị nghẽn phía sau các chiến dịch hàng loạt.
- **Scope chính** (in scope):
  - Tiếp nhận sự kiện bất đồng bộ qua Transactional Outbox và Event Broker (Kafka)
  - Gửi thông báo đa kênh: Mobile Push (APNs/FCM), Email (SES/SendGrid), SMS (Twilio/Vonage), In-app (WebSocket/Inbox)
  - Phân tầng độ ưu tiên (`CRITICAL`, `INTERACTIVE`, `BULK`), cô lập tải theo kênh và kiểm soát tốc độ hai chiều (chống vượt quota provider và chống Self-DDoS)
  - Sharded fan-out có checkpoint để tiếp tục an toàn khi worker gặp sự cố giữa chừng
  - Quản lý tùy chọn người dùng (Preferences, Quiet Hours theo múi giờ, Frequency Capping, Presence-aware routing) và vòng đời Device Token
  - Xử lý lỗi bền vững: phân loại lỗi tạm thời/vĩnh viễn, Exponential Backoff + Jitter, Idempotency hai lớp, kiểm tra TTL/hủy chiến dịch và Dead Letter Queue (DLQ) có replay an toàn
  - Bảo vệ vận hành thực tế: chống SMS Pumping, tách uy tín IP Email, allowlist môi trường Staging, Kill Switch và giám sát lỗi ngầm
- **Scope ngoài bài** (out of scope): Hệ thống biên soạn chiến dịch marketing kéo-thả (CRM/WYSIWYG editor), hệ thống ML dự đoán thời điểm mở thông báo tối ưu, transcoding/lưu trữ video gốc, chat 1-1 thời gian thực.
- **Mục tiêu business**: Tăng tương tác người dùng (engagement) qua thông báo đúng lúc và đúng nội dung, duy trì độ tin cậy cao cho thông báo bảo mật/giao dịch, kiểm soát chặt chi phí SMS/Email và bảo vệ uy tín gửi tin (deliverability) của nền tảng.

## 2. 🔍 Requirement Gathering & Analysis

### 2.1 Functional Requirements

| Priority | Requirement | Mô tả |
|---|---|---|
| MUST-HAVE | Trigger notification event | Các domain service (Upload, Auth, Billing) phát sự kiện thông báo qua Outbox/API nội bộ mà không phải chờ giao tới người dùng cuối |
| MUST-HAVE | Multi-channel delivery | Hỗ trợ gửi qua Mobile Push (APNs/FCM), Email, SMS và In-app Inbox với pipeline tách biệt theo từng kênh |
| MUST-HAVE | Priority-based routing | Phân tách rõ thông báo khẩn cấp (`CRITICAL`: OTP, bảo mật), tương tác (`INTERACTIVE`: comment, reply) và hàng loạt (`BULK`: video mới từ creator) |
| MUST-HAVE | Large-scale fan-out | Khi creator có 1M–10M subscribers đăng video, hệ thống mở rộng danh sách theo batch có checkpoint để không mất dấu nếu worker restart |
| MUST-HAVE | User preferences & opt-out | Người dùng bật/tắt thông báo theo từng loại sự kiện và từng kênh, hỗ trợ One-click Unsubscribe cho email hàng loạt |
| MUST-HAVE | Device token management | Đăng ký, cập nhật, hủy liên kết token khi logout (tránh rò rỉ tài khoản) và tự động vô hiệu hóa token chết từ phản hồi APNs/FCM |
| MUST-HAVE | Retry, Idempotency & DLQ | Tự động retry lỗi tạm thời với backoff + jitter, giảm gửi trùng bằng khóa idempotency, đẩy lỗi vĩnh viễn hoặc hết lượt sang DLQ |
| MUST-HAVE | Delivery status tracking | Theo dõi vòng đời thông báo (`QUEUED → ACCEPTED → DELIVERED / FAILED / EXPIRED`) để support tra cứu và đo tỷ lệ giao thành công |
| NICE-TO-HAVE | Quiet Hours & Frequency Capping | Hoãn thông báo không khẩn vào khung giờ yên tĩnh theo múi giờ người dùng; giới hạn số thông báo/giờ hoặc gom thành Digest |
| NICE-TO-HAVE | Presence-aware routing | Nếu người dùng đang mở app (WebSocket active), ưu tiên hiển thị In-app thay vì bắn Push/SMS gây phiền và tốn chi phí |
| NICE-TO-HAVE | Campaign Kill Switch & Canary | Cho phép gửi thử 0.1% người dùng trước khi mở toàn chiến dịch và dừng khẩn cấp chiến dịch đang fan-out trong vài giây |

### 2.2 Non-Functional Requirements

- **Performance**:
  - Ingestion API / Outbox publish: p95 < 50ms, p99 < 150ms (chỉ ghi DB/Outbox hoặc nhận event, không chờ provider)
  - `CRITICAL` notifications (OTP, cảnh báo đăng nhập): end-to-end tới provider p95 < 2s, p99 < 5s
  - `INTERACTIVE` notifications (comment/reply): p95 < 10s
  - `BULK` notifications (1 triệu subscribers đăng video): rải đều có kiểm soát (pacing) hoàn tất trong 5–15 phút để tránh Self-DDoS
  - In-app Inbox read API: p95 < 100ms
- **Scalability**: Hỗ trợ 50M DAU, trung bình ~500M thông báo/ngày (~5,787 deliveries/s), peak gấp 10x khi nhiều creator lớn đăng video giờ vàng (~57,870 deliveries/s).
- **Availability**: SLA **99.99%** cho đường tiếp nhận sự kiện và làn `CRITICAL` (OTP/Security); **99.9%** cho làn `BULK` và trang quản trị.
- **Consistency**:
  - **Strong consistency** cho Outbox commit cùng nghiệp vụ (không mất sự kiện sau khi DB commit), hủy liên kết `device_token` khi logout, và trạng thái hủy chiến dịch (`Kill Switch` có hiệu lực trong < 2s qua Redis).
  - **Eventual consistency** cho Delivery Status cập nhật từ webhook provider (< 30s), cập nhật User Preferences (cache TTL 5 phút, invalidate ngay khi user đổi cài đặt), và In-app unread badge (< 3s).
  - Cam kết giao nhận **At-least-once** kết hợp chống trùng tốt nhất có thể (best-effort deduplication).
- **Security**: mTLS + Service Token cho internal APIs, JWT cho user APIs, mã hóa dữ liệu nhạy cảm (PII: email, SĐT) bằng KMS, chống **SMS Pumping (Toll Fraud)**, escape HTML template chống XSS, và **hard allowlist** ở Egress Gateway của môi trường Staging/Test.
- **Cost**: Tối ưu hạ tầng ở mức ~$15,000–$30,000/tháng cho tầng nền tảng ở quy mô trung bình; tách rõ chi phí hạ tầng với chi phí biến đổi của SMS/Email provider (có budget circuit breaker).
- **Observability**: Golden Signals theo từng `(channel, priority)`, theo dõi `queue_oldest_message_age`, tách tỷ lệ giao/mở theo từng domain email / nhà mạng SMS / OS để phát hiện lỗi ngầm, kèm Synthetic Canary gửi định kỳ.

### 2.3 Capacity Estimation (Back-of-the-envelope)

#### Bước 0: Quy ước đơn vị
- `1 day = 86,400 seconds`
- `1M = 1,000,000`, `1B = 1,000,000,000`
- Dùng hệ thập phân cho lưu trữ và băng thông: `1KB = 1,000B`, `1MB = 1,000KB`, `1GB = 1,000MB`, `1TB = 1,000GB`

#### Bước 1: Inputs giả định

| Input | Giá trị | Tại sao chọn |
|---|---|---|
| DAU | 50M users/day | Quy mô nền tảng video/mạng xã hội cỡ lớn |
| Tổng thông báo/user/ngày | 10 deliveries/user/day | Bao gồm Push video mới (~6), In-app (~2.5), Email (~1.2), SMS (~0.3) |
| Tỷ lệ phân bổ theo kênh | Push 60%, In-app 25%, Email 12%, SMS 3% | Push/In-app chiếm đa số do chi phí gần như bằng 0; SMS chỉ dùng cho OTP/bảo mật |
| Tỷ lệ phân bổ theo ưu tiên | Critical 5%, Interactive 25%, Bulk 70% | Video mới & khuyến mãi chiếm phần lớn lưu lượng |
| Kích thước campaign payload | 2KB | Template variables + metadata JSON (lưu 1 lần cho cả chiến dịch) |
| Kích thước 1 dòng delivery status | 250B | IDs, channel, status, attempt_count, provider_msg_id, timestamps |
| Kích thước preference + devices/user | 500B | Preferences bitmask/JSON (~150B) + trung bình 2 device tokens (~350B) |
| Tỷ lệ retry trung bình | 8% | Do timeout mạng, 429 tạm thời, provider chập chờn |
| Peak factor | 10x | Nhiều creator 1M–5M subscribers cùng đăng video vào khung giờ vàng 19h–21h |

#### Bước 2: Tính lưu lượng giao hàng (Delivery QPS)
- Công thức: `total_deliveries_per_day = DAU × notifications_per_user`
- Thay số: `50,000,000 × 10 = 500,000,000 = 500M deliveries/day`
- Công thức: `avg_delivery_qps = total_deliveries_per_day / 86,400`
- Thay số: `500,000,000 / 86,400 = 5,787`
- Cộng 8% retry overhead: `5,787 × 1.08 = 6,250`
- Kết quả: **avg delivery QPS ≈ 6,250 attempts/s**
- Peak factor `×10`: `6,250 × 10 = 62,500`
- Kết quả: **peak delivery QPS ≈ 62,500 attempts/s**

Phân tách Peak QPS theo từng kênh (dùng tỷ lệ bước 1):
- **Push Peak:** `62,500 × 60% = 37,500 req/s`
- **In-app Peak:** `62,500 × 25% = 15,625 req/s`
- **Email Peak:** `62,500 × 12% = 7,500 req/s`
- **SMS Peak:** `62,500 × 3% = 1,875 req/s`

#### Bước 3: Tính độ đồng thời (In-flight Concurrency) theo Little's Law
- Giả sử độ trễ trung bình gọi provider bên ngoài (APNs/FCM/SES/Twilio) là `150ms` (`0.15s`), nhưng 5% request bị chậm tới `3s`.
- Độ trễ có trọng số: `0.95 × 0.15 + 0.05 × 3.0 = 0.1425 + 0.15 = 0.2925s ≈ 0.3s`
- Công thức: `in_flight = peak_external_qps × weighted_latency`
- External peak QPS (Push + Email + SMS): `37,500 + 7,500 + 1,875 = 46,875 req/s`
- Thay số: `46,875 × 0.3 = 14,062`
- Kết quả: **peak in-flight HTTP calls ≈ 14,062 concurrent connections**

> 📌 Nếu không tách pool theo kênh, chỉ cần Email provider tăng latency lên 5s là hàng nghìn kết nối bị giữ cứng, làm nghẽn cả Push và SMS.

#### Bước 4: Tính tốc độ Fan-out cho sự kiện 1M subscribers
- Giả sử mục tiêu hoàn tất fan-out + pacing cho 1 creator 1M subscribers trong **5 phút (300 giây)** để không gây Self-DDoS.
- Tốc độ phát cần thiết cho 1 chiến dịch: `1,000,000 / 300 = 3,333 jobs/s`
- Chia thành **64 shards**, mỗi shard quản lý `1,000,000 / 64 ≈ 15,625 subscribers`, đọc theo batch `1,000` → chỉ khoảng `16` truy vấn keyset/shard.
- Khi 10 creator cùng cỡ 1M đăng đồng thời: `10 × 3,333 = 33,333 jobs/s` (vẫn nằm trong ngưỡng Push Peak 37,500/s).

#### Bước 5: Tính lưu trữ Delivery Status & Campaign Data
- Delivery rows mỗi ngày: `500,000,000 × 250B = 125,000,000,000B = 125GB/day`
- Hot retention **14 ngày** trong PostgreSQL (partition theo ngày): `125GB × 14 = 1,750GB = 1.75TB`
- Cộng indexes (~60%): `1.75TB × 1.6 = 2.8TB` hot storage
- Dữ liệu lạnh 1 năm (nén Parquet trên S3 tỷ lệ ~5:1): `(125GB × 365) / 5 = 45,625GB / 5 ≈ 9.1TB/year`
- Bảng `user_preferences` + `user_devices` (cho 200M tổng user đăng ký): `200,000,000 × 500B = 100GB` (cộng index ~160GB — rất gọn trong PostgreSQL).

#### Bước 6: Tính bộ nhớ Cache (Redis)
- **Preference & Device Token cache** cho 50M DAU: `50,000,000 × 500B = 25GB`
- **Idempotency / Dedup keys** (TTL 24 giờ cho 500M deliveries, mỗi key+metadata ~64B): `500,000,000 × 64B = 32GB`
- **Presence (online WebSocket users)** (~10% DAU = 5M concurrent users × 64B): `0.32GB`
- **Frequency capping counters + Rate limiter buckets**: ~`5GB`
- Tổng RAM dữ liệu: `25 + 32 + 0.32 + 5 = 62.32GB`
- Cộng Redis overhead + headroom 40%: `62.32GB × 1.4 ≈ 87.2GB`
- Kết quả: **Redis Cluster memory ≈ 90GB** (chưa tính replica HA ×2 = ~180GB tổng cụm).

#### Bước 7: Tính băng thông (Kafka & Egress)
- Kích thước trung bình 1 message delivery job trên Kafka (tham chiếu `campaign_id` + `user_id` + `device_token` + biến cá nhân hóa gọn): ~`600B`
- Avg Kafka throughput: `6,250 × 600B = 3.75MB/s`
- Peak Kafka throughput: `62,500 × 600B = 37.5MB/s` (nhân replication factor 3 ≈ `112.5MB/s` nội bộ cụm MSK)
- Egress HTTP payload tới providers ở peak (trung bình ~1.2KB gồm header + JSON body): `46,875 × 1.2KB ≈ 56.25MB/s`

#### Bước 8: So sánh kịch bản

| Metric | Base (50M DAU) | Conservative (10M DAU) | Ghi chú |
|---|---|---|---|
| Delivery QPS (avg / peak) | 6,250 / 62,500 | 1,250 / 12,500 | Peak = 10x khung giờ vàng |
| Push Peak QPS | 37,500 | 7,500 | Kênh chiếm tỷ trọng lớn nhất |
| Peak In-flight HTTP | ~14,062 | ~2,812 | Tính theo tail latency 5% ở 3s |
| Hot Delivery Storage (14d + idx) | ~2.8TB | ~560GB | Partition theo ngày, drop sau 14 ngày |
| Cold Storage / year (S3 Parquet) | ~9.1TB | ~1.82TB | Lưu dài hạn cho analytics/audit |
| Redis Cluster Memory (primary) | ~90GB | ~18GB | Gồm Dedup 24h + Prefs + Rate limit |
| Peak Kafka Throughput | ~37.5MB/s | ~7.5MB/s | Nhỏ nhờ tách payload về Campaign table |

> 📌 Lưu ý quan trọng: nếu nhồi toàn bộ payload 2KB vào từng Kafka message và từng dòng delivery status thay vì tham chiếu `campaign_id`, lưu lượng Kafka tăng gấp 3–4 lần và hot storage tăng từ 2.8TB lên >15TB.

#### Bước 9: 📊 Bảng tổng hợp Capacity Estimation

| ID | Metric | Avg | Peak | Quyết định được drive bởi số liệu này |
|---|---|---|---|---|
| C1 | Total Delivery QPS | ~6,250 | **~62,500** | §3.2 Chọn Kafka + Priority/Channel Queues · §10 MSK 6 brokers, tổng ≥ 64 partitions |
| C2 | Push Peak QPS | ~3,750 | **~37,500** | §3.2 Chọn Sharded Fan-out + Pacing thay vì xả không giới hạn · §10 HPA Push Worker min=8, max=40 |
| C3 | Email & SMS Peak QPS | ~937 | **~9,375** | §3.3 Tách pipeline Bulkhead cho Email/SMS · §10 HPA Email min=4, max=16; SMS min=2, max=8 |
| C4 | Peak In-flight HTTP | ~1,406 | **~14,062** | §10 Virtual Threads / async HTTP client (WebClient/Netty) với bounded connection pool riêng từng provider |
| C5 | Hot Delivery Storage (14d) | **~2.8TB** | — | §8 Partition `notification_deliveries` theo ngày (~200GB/partition gồm index), drop partition > 14d · §17 RDS `db.r6g.4xlarge` + 4TB gp3 |
| C6 | Cold Audit Storage/year | **~9.1TB** | — | §8 Archive daily partition sang S3 Parquet + Lifecycle Glacier · §17 S3 storage sizing |
| C7 | Redis Cluster Memory | **~90GB** | — | §3.4 Dedup TTL 24h + Preference cache + Distributed Token Bucket · §10 ElastiCache 6 shards × `cache.r6g.xlarge` (26GB) |
| C8 | Kafka Peak Throughput | ~3.75MB/s | **~37.5MB/s** | §8 Tách bảng `notification_campaigns` tránh lặp payload · §10 MSK `kafka.m5.xlarge` × 6 brokers (RF=3) |

## 3. ⚖️ Trade-offs

### 3.1 Bảng tổng quan quyết định

| Decision | Option A | Option B | Option C | Chọn | Lý do chính |
|---|---|---|---|---|---|
| Event ingestion từ Domain API | Gọi trực tiếp Notification API (Sync) | Dual-write DB + Kafka | **Transactional Outbox + CDC/Relay** | **Transactional Outbox** | Loại bỏ hoàn toàn mất sự kiện sau DB commit; không kéo dài latency Upload API |
| Fan-out cho creator lớn (1M–10M subs) | 1 consumer đọc tuần tự | Topic Broadcast (FCM Topic) | **Sharded Fan-out + Checkpoint + Pacing** | **Sharded Fan-out + Checkpoint** | Resume an toàn khi crash, kiểm soát pacing chống Self-DDoS, hỗ trợ Quiet Hours/Prefs |
| Cô lập tải & độ ưu tiên | 1 Kafka topic chung | Tách theo kênh nhưng chung ưu tiên | **Tách theo cả `(channel, priority)`** | **Tách `(channel, priority)`** | Chống noisy neighbor (video 10M subs không chặn OTP) và Bulkhead chống lỗi dây chuyền |
| Delayed Retry trên Kafka | Worker `Thread.sleep()` | Polling DB toàn bộ job | **Tiered Retry Topics + Delayed Scheduler** | **Tiered Retry Topics + Scheduler** | Không khóa thread worker, không quá tải DB ở peak `[C1]`, hỗ trợ backoff + jitter |
| Lưu trạng thái Delivery | PostgreSQL 1 bảng phẳng | Cassandra ngay từ đầu | **PostgreSQL Daily Partition (14d) + S3 Parquet** | **PostgreSQL Partitioned + S3** | Giữ đúng stack mặc định, quản lý 2.8TB `[C5]` gọn nhờ `DROP PARTITION`, chi phí thấp |
| Idempotency giao hàng | Chỉ dedup nội bộ | Kỳ vọng Exactly-once | **At-least-once + Idempotency 2 lớp** | **Idempotency 2 lớp** | Thực tế mạng và provider không hứa exactly-once; chống trùng tối đa ở cả nội bộ lẫn provider |

### 3.2 Deep-dive: Sharded Fan-out + Checkpoint vs FCM Topic Broadcast

| Tiêu chí | Sharded Fan-out + Checkpoint | FCM Topic Broadcast |
|---|---|---|
| Số lệnh gọi tới Provider cho 1M subs | ~1M (gửi theo batch API ~500 token/call → ~2,000 HTTP calls) | 1 lệnh gọi duy nhất tới topic |
| Kiểm soát Pacing (chống Self-DDoS) | Rất tốt — điều chỉnh được tốc độ xả theo giây `[C2]` | Kém — FCM xả đồng loạt gây traffic spike đập ngược API video |
| Cá nhân hóa & lọc theo từng user | Đầy đủ (ngôn ngữ, Quiet Hours, Frequency Cap, Presence) | Rất hạn chế — mọi người nhận cùng một nội dung |
| Delivery tracking theo từng user | Chi tiết từng `(campaign_id, user_id)` | Không có trạng thái chi tiết từng thiết bị |
| Khả năng mở rộng đa kênh | Dùng chung cho Push, Email, SMS, In-app | Chỉ áp dụng cho FCM (không dùng cho Email/SMS) |

**Hoạt động thế nào?**
- **Sharded Fan-out + Checkpoint:** Bảng `subscriptions` được gán `shard_id = hash(subscriber_id) % 64`. Khi nhận sự kiện `video.published`, Fan-out Coordinator phát 64 fan-out task vào Kafka topic `fanout.tasks` (một task ứng với một shard). Các Fan-out Worker tiêu thụ song song, đọc theo keyset pagination `WHERE creator_id = ? AND shard_id = ? AND subscriber_id > ? ORDER BY subscriber_id LIMIT 1000`, lọc Preferences/Quiet Hours/Presence theo batch, đẩy delivery job vào topic kênh tương ứng, rồi cập nhật `last_subscriber_id` trong `fanout_checkpoints`.
- **Topic Broadcast:** Khi user bấm Subscribe kênh A, app đăng ký `device_token` vào topic `creator_A` trên FCM. Khi kênh A đăng video, backend gửi 1 message vào `/topics/creator_A`.

**Ví dụ với số thật:**
Creator `creator_99` có **1,000,000 subscribers**, chia 64 shards → mỗi shard có **~15,625 subscribers**. Với batch size 1,000, mỗi shard chỉ cần **16 truy vấn keyset**. Nếu pod phụ trách `shard_12` bị OOM-kill sau khi xử lý xong subscriber thứ `9,000`, pod mới nhận lại `shard_12`, đọc `last_subscriber_id` ở checkpoint và chỉ chạy lại từ dòng `9,001` — không gửi trùng `9,000` người đầu. Với mục tiêu pacing `3,333 push/s`, toàn bộ 1M subscribers nhận tin rải đều trong ~5 phút, giảm 90% đỉnh tải đập ngược vào Video API so với bắn hết trong 15 giây.

**Pseudo-code so sánh:**
```java
// Option A: Sharded Fan-out + Checkpoint (chọn)
long cursor = checkpointRepo.getLastSubscriberId(campaignId, shardId);
while (!campaignCache.isCancelled(campaignId)) {
    List<Long> subIds = subRepo.findNextBatch(creatorId, shardId, cursor, 1000);
    if (subIds.isEmpty()) break;
    List<DeliveryJob> jobs = filterAndBuildJobs(campaign, subIds); // Prefs, Quiet Hours, Presence
    kafkaTemplate.sendBatch(jobs);
    cursor = subIds.get(subIds.size() - 1);
    checkpointRepo.saveCursor(campaignId, shardId, cursor);
}

// Option B: Topic Broadcast (không chọn làm mặc định)
fcmClient.sendToTopic("creator_" + creatorId, buildGenericMessage(video));
```

**Kết luận:** Chọn **Sharded Fan-out + Checkpoint** làm kiến trúc chính để kiểm soát được tốc độ rải tải `[C2]`, lọc Quiet Hours/Presence và hỗ trợ đồng nhất mọi kênh. Chỉ cân nhắc Topic Broadcast cho tin công cộng khẩn cấp không cá nhân hóa (ví dụ cảnh báo hệ thống toàn cầu).

### 3.3 Deep-dive: Tách Queue theo `(channel, priority)` vs 1 Queue chung

| Tiêu chí | 1 Queue chung | Tách theo `(channel, priority)` |
|---|---|---|
| Cách ly noisy neighbor | Kém — 10M tin video làm kẹt OTP hàng chục phút | Tuyệt đối — `sms.critical` và `push.critical` có topic & worker pool riêng |
| Cách ly lỗi provider (Bulkhead) | Kém — Email provider chậm kéo nghẽn Push | Tốt — mỗi kênh có consumer group, timeout và connection pool riêng `[C3]` |
| Độ phức tạp vận hành | Rất thấp (1 topic, 1 deployment) | Trung bình (6–8 topics, 4 worker deployments trên EKS) |
| Autoscale theo nhu cầu | Scale cả cụm tốn tài nguyên | HPA độc lập theo Kafka consumer lag của từng kênh `[C2][C3]` |

**Hoạt động thế nào?**
- Tạo các topic tách biệt: `notif.push.critical`, `notif.push.bulk`, `notif.email.transactional`, `notif.email.bulk`, `notif.sms.critical`, `notif.inapp.realtime`.
- Mỗi Deployment worker trên EKS chỉ subscribe các topic của kênh mình, với riêng một Deployment (hoặc dedicated consumer threads) cho làn `critical` để bảo đảm ngay cả khi `notif.push.bulk` có lag 5 triệu message thì `notif.push.critical` vẫn có lag gần bằng 0.

**Kết luận:** Với chênh lệch SLO giữa OTP (< 2s) và Video mới (5–15 phút), tách theo `(channel, priority)` là yêu cầu bắt buộc. Nhược điểm tăng số lượng topic được giải quyết gọn bằng Terraform/Helm template chuẩn hóa.

### 3.4 Deep-dive: Delayed Retry trên Kafka (Tiered Retry Topics vs Polling DB)

| Tiêu chí | Tiered Retry Topics (10s, 1m, 5m, 30m) + Scheduler | Polling PostgreSQL liên tục |
|---|---|---|
| Áp lực lên PostgreSQL | Thấp — DB chỉ lưu trạng thái, không quét `next_retry_at` ở peak | Rất cao — ở peak 62.5K QPS `[C1]`, bảng retry dễ tạo lock/IOPS bottleneck |
| Độ linh hoạt thời gian chờ | Bậc cố định (+ random jitter vài giây), delay xa (>1h) giao cho Scheduler | Tùy ý chính xác từng giây |
| Tận dụng stack mặc định | Dùng sẵn MSK (Kafka) | Dùng sẵn PostgreSQL |

**Hoạt động thế nào?**
- Khi Push Worker nhận `429` hoặc `503` (lần 1), nó gắn header `deliver_after = now + 10s + random(0..5s)` và đẩy vào topic `notif.push.retry.10s`.
- Consumer đọc topic `retry.10s`: vì các message trong cùng topic có thời gian chờ gần bằng nhau (xấp xỉ FIFO), nếu message đầu chưa tới `deliver_after` thì consumer tạm `pause()` partition vài trăm ms rồi `resume()`, không cần quét DB.
- Các lần retry tiếp theo lần lượt đi qua `retry.1m` → `retry.5m` → `retry.30m` → `notif.push.dlq`. Riêng thông báo bị hoãn theo **Quiet Hours** (ví dụ hoãn 6 tiếng sang 8h sáng) được lưu vào bảng `scheduled_notifications` (lượng nhỏ, index theo `deliver_at`) để Delayed Scheduler quét mỗi phút.

**Kết luận:** Kết hợp **Tiered Retry Topics** cho lỗi mạng ngắn hạn (tận dụng throughput `[C8]` của Kafka) và **Scheduled Table** cho Quiet Hours dài hạn mang lại sự cân bằng tốt nhất giữa hiệu năng và độ đơn giản.

### 3.5 Deep-dive: Lưu Delivery Status trên PostgreSQL Partitioned vs Cassandra

| Tiêu chí | PostgreSQL Daily Partitioned + S3 Archive | Apache Cassandra |
|---|---|---|
| Khả năng chịu ghi 62.5K peak `[C1]` | Khả thi khi batch-insert từ Status Aggregator (100–500 rows/tx → ~200 batch writes/s) | Rất tốt cho ghi lẻ phân tán |
| Truy vấn tra cứu cho Support | Linh hoạt (filter theo `user_id`, `campaign_id`, `status`) | Chỉ query tốt theo partition key thiết kế sẵn |
| Dọn dữ liệu cũ (14 ngày) | `DROP TABLE notification_deliveries_2026_03_01` mất vài mili-giây, không tạo bloat | Dùng native TTL (nhưng tạo tombstone compaction overhead) |
| Chi phí vận hành & đội ngũ | Dùng chung stack mặc định PostgreSQL | Cần thêm năng lực vận hành cụm Cassandra riêng |

> 💡 **Tại sao vẫn giữ PostgreSQL mặc định thay vì chuyển ngay sang Cassandra?**
> Nếu mỗi Delivery Worker tự `INSERT/UPDATE` từng dòng trực tiếp vào PostgreSQL ở 62,500 QPS, database sẽ nghẽn kết nối và WAL ngay lập tức. Thay vào đó, worker phát các status event nhẹ vào topic `notif.delivery.status`, và một **Status Aggregator Service** gom 200–500 sự kiện để batch `INSERT ... ON CONFLICT DO UPDATE` mỗi 200ms (~150–300 câu lệnh SQL/giây). Nhờ gom batch + daily partitioning (`2.8TB` hot `[C5]`), PostgreSQL vẫn gánh tốt mà không cần thêm Cassandra. Chỉ chuyển sang Cassandra/ScyllaDB khi sản lượng vượt > 2–3 tỷ deliveries/ngày.

## 4. 🧩 Defining Entities / Components

Sơ đồ dưới đây thể hiện toàn bộ thành phần logic của Notification System, phân tách rõ lớp biên (Edge/Gateway), lớp điều phối sự kiện (Fan-out & Routing), lớp giao hàng tách kênh (Channel Workers), lớp dữ liệu và giám sát.

```d2 interactive title="notification-system — Thành phần hệ thống"
direction: down

Edge: "Edge & Gateway Layer" {
}
Upstream: "Upstream Producers" {
}
Orchestration: "Notification Core (EKS)" {
}
Delivery: "Channel Delivery Workers (EKS)" {
}
Async: "Event & Queue Layer (Kafka / MSK)" {
}
Data: "Data & Cache Layer" {
}
External: "External Providers" {
}
Observability: "Observability" {
}

Edge.Client: "Client\n(Mobile App / Web SPA)"
Edge.WAF: "AWS WAF\n(DDoS & Bot Filter)" {
  icon: ./diagrams/icons/waf.svg
}
Edge.ALB: "ALB\n(L7 Load Balancer)" {
  icon: ./diagrams/icons/load-balancer.svg
}
Edge.APIGW: "API Gateway\n(JWT Auth, Rate Limit)"

Upstream.DomainSvc: "Domain Services\n(Upload, Auth, Billing)"
Upstream.OutboxRelay: "Outbox Relay / CDC\n(Debezium)"

Orchestration.IngestSvc: "Notification API\n(Events, Prefs, Devices, Inbox)"
Orchestration.FanoutCoord: "Fan-out Coordinator\n(Shard Planner + Kill Switch)"
Orchestration.FanoutWorker: "Sharded Fan-out Workers\n(Filter, Quiet Hours, Pacing)"
Orchestration.Scheduler: "Delayed Scheduler\n(Quiet Hours & Replay)"
Orchestration.StatusAgg: "Status Aggregator\n(Batch DB Writer + Webhooks)"
Orchestration.TemplateSvc: "Template & Localization\nService"

Delivery.PushW: "Push Workers\n(Critical + Bulk Pools)"
Delivery.EmailW: "Email Workers\n(Transactional + Bulk)"
Delivery.SmsW: "SMS Workers\n(Critical + Spend Cap)"
Delivery.InappW: "In-app / WebSocket\nGateway"
Delivery.EgressProxy: "Egress Guard Proxy\n(Staging Allowlist, mTLS)"

Async.EventTopic: "notif.events\n(Inbound Events)"
Async.FanoutTopic: "fanout.tasks\n(64 Shards)"
Async.ChannelTopics: "Priority & Channel Topics\n(push / email / sms / inapp)"
Async.RetryDlq: "Tiered Retry Topics\n& DLQ"
Async.StatusTopic: "notif.delivery.status"

Data.PG_Primary: "PostgreSQL Primary\n(Campaigns, Prefs, Devices,\nCheckpoints, Deliveries)" {
  icon: ./diagrams/icons/postgres.svg
}
Data.PG_Replica: "PostgreSQL Replica\n(Inbox & Support Read)" {
  icon: ./diagrams/icons/postgres.svg
}
Data.Redis: "Redis Cluster\n(Rate Limit, Dedup 24h,\nPresence, Pref Cache)" {
  icon: ./diagrams/icons/redis.svg
}
Data.S3: "S3 Archive\n(Parquet Audit + Templates)" {
  icon: ./diagrams/icons/s3.svg
}

External.PushP: "APNs / FCM"
External.EmailP: "SES / SendGrid\n(Tách IP Trans/Bulk)"
External.SmsP: "Twilio / Vonage\n(Multi-provider)"

Observability.Prom: "Prometheus + Grafana"
Observability.ELK: "ELK / OpenSearch"
Observability.Jaeger: "OpenTelemetry / Jaeger"

Edge.Client -> Edge.WAF
Edge.WAF -> Edge.ALB
Edge.ALB -> Edge.APIGW
Edge.APIGW -> Orchestration.IngestSvc
Edge.APIGW -> Delivery.InappW: "WebSocket / WSS"

Upstream.DomainSvc -> Upstream.OutboxRelay: "Transactional Outbox"
Upstream.OutboxRelay -> Async.EventTopic
Orchestration.IngestSvc -> Data.PG_Primary
Orchestration.IngestSvc -> Data.PG_Replica
Orchestration.IngestSvc -> Data.Redis
Orchestration.IngestSvc -> Async.EventTopic

Async.EventTopic -> Orchestration.FanoutCoord
Orchestration.FanoutCoord -> Data.PG_Primary: "Create campaign"
Orchestration.FanoutCoord -> Async.FanoutTopic: "Emit 64 shard tasks"
Async.FanoutTopic -> Orchestration.FanoutWorker
Orchestration.FanoutWorker -> Data.PG_Replica: "Keyset read subscribers"
Orchestration.FanoutWorker -> Data.PG_Primary: "Save checkpoint"
Orchestration.FanoutWorker -> Data.Redis: "Check Prefs, Cap, Presence"
Orchestration.FanoutWorker -> Async.ChannelTopics: "Route by channel & priority"
Orchestration.FanoutWorker -> Data.PG_Primary: "Schedule Quiet Hours"

Orchestration.Scheduler -> Data.PG_Primary: "Poll due jobs"
Orchestration.Scheduler -> Async.ChannelTopics

Async.ChannelTopics -> Delivery.PushW
Async.ChannelTopics -> Delivery.EmailW
Async.ChannelTopics -> Delivery.SmsW
Async.ChannelTopics -> Delivery.InappW

Delivery.PushW -> Orchestration.TemplateSvc
Delivery.EmailW -> Orchestration.TemplateSvc
Delivery.SmsW -> Orchestration.TemplateSvc

Delivery.PushW -> Data.Redis: "Dedup & Rate Limit"
Delivery.EmailW -> Data.Redis: "Dedup & Rate Limit"
Delivery.SmsW -> Data.Redis: "Dedup & Spend Cap"

Delivery.PushW -> Delivery.EgressProxy
Delivery.EmailW -> Delivery.EgressProxy
Delivery.SmsW -> Delivery.EgressProxy
Delivery.EgressProxy -> External.PushP
Delivery.EgressProxy -> External.EmailP
Delivery.EgressProxy -> External.SmsP

Delivery.PushW -> Async.RetryDlq
Delivery.EmailW -> Async.RetryDlq
Delivery.SmsW -> Async.RetryDlq
Async.RetryDlq -> Delivery.PushW
Async.RetryDlq -> Delivery.EmailW
Async.RetryDlq -> Delivery.SmsW

Delivery.PushW -> Async.StatusTopic
Delivery.EmailW -> Async.StatusTopic
Delivery.SmsW -> Async.StatusTopic
Delivery.InappW -> Async.StatusTopic
External.EmailP -> Orchestration.StatusAgg: "Bounce / Complaint Webhook"
External.SmsP -> Orchestration.StatusAgg: "Delivery Receipt Webhook"
Async.StatusTopic -> Orchestration.StatusAgg
Orchestration.StatusAgg -> Data.PG_Primary: "Batch upsert status"
Orchestration.StatusAgg -> Data.S3: "Daily Parquet archive"

Data.PG_Primary -> Data.PG_Replica
Delivery.PushW -> Observability.Prom {style.stroke-dash: 4}
Orchestration.FanoutWorker -> Observability.Prom {style.stroke-dash: 4}
Orchestration.StatusAgg -> Observability.ELK {style.stroke-dash: 4}
Orchestration.IngestSvc -> Observability.Jaeger {style.stroke-dash: 4}
```

| Component | Vai trò |
|---|---|
| **Domain Services + Outbox Relay** | Ghi sự kiện thông báo trong cùng transaction nghiệp vụ, sau đó Debezium/Relay chuyển bền vững sang Kafka `notif.events` |
| **Notification API** | Phục vụ REST API nội bộ (trigger trực tiếp khi cần), quản lý User Preferences, Device Token, Kill Switch và đọc In-app Inbox |
| **Fan-out Coordinator** | Tạo bản ghi `notification_campaigns`, làm ấm cache video/template nếu cần, và chia sự kiện lớn thành 64 shard task |
| **Sharded Fan-out Workers** | Đọc subscribers bằng keyset pagination có checkpoint, kiểm tra Preferences / Quiet Hours / Frequency Cap / Presence và rải tải (pacing) vào topic kênh |
| **Template & Localization Service** | Render nội dung theo `template_id`, `template_version`, ngôn ngữ người dùng và escape dữ liệu động chống HTML/XSS injection |
| **Channel Workers (Push / Email / SMS)** | Kiểm tra TTL và Kill Switch, claim idempotency, xin token từ Redis Rate Limiter, gọi provider và phân loại kết quả (202 / 429 / 410 / DLQ) |
| **In-app / WebSocket Gateway** | Giữ kết nối WebSocket cho người dùng đang mở app, cập nhật trạng thái online (Presence) trong Redis và đẩy thông báo trực tiếp không tốn chi phí Push |
| **Egress Guard Proxy** | Chặn gửi nhầm ra khách hàng thật từ môi trường Staging (hard allowlist), áp dụng timeout/TLS chuẩn và ẩn thông tin xác thực provider |
| **Delayed Scheduler** | Quét các thông báo bị hoãn do Quiet Hours và điều phối replay từ DLQ với giới hạn tốc độ |
| **Status Aggregator** | Nhận sự kiện trạng thái từ worker và webhook từ Email/SMS provider (Delivered, Hard Bounce, Spam Complaint), gom batch ghi PostgreSQL và cập nhật Suppression List |

## 5. 🔗 Client-Server Connection

- **Protocols**:
  - **REST over HTTPS (JSON):** Dùng cho quản lý Preferences, đăng ký/hủy Device Token, lấy danh sách In-app Inbox, đánh dấu đã đọc, và internal trigger API (hoặc gRPC nội bộ giữa các microservice).
  - **WebSocket (`WSS`):** Duy trì kết nối hai chiều cho người dùng đang mở web/app để đẩy In-app notification tức thì và đồng bộ trạng thái đã đọc (read-state sync) giữa các thiết bị.
  - **Webhook (HTTPS POST):** Nhận trạng thái giao hàng thực tế, Hard Bounce và Spam Complaint từ nhà cung cấp Email/SMS.
- **Authentication**:
  - **Client → API Gateway:** JWT (`RS256`, access token 15 phút) chứa `user_id` và `device_id`.
  - **Internal Services → Notification API:** mTLS nội bộ kết hợp Service JWT / API Key gắn theo `service_name` và quyền gửi kênh (`sms:critical` chỉ cấp cho Auth/Security Service, ngăn dịch vụ marketing vô tình bắn SMS).
  - **Provider Webhooks → Status Aggregator:** Xác thực chữ ký HMAC (hoặc SNS signature) theo từng provider và timestamp window chống replay attack.
- **Connection patterns**:
  - **Request-Response:** Quản lý cài đặt, inbox, đăng ký token.
  - **Event-Driven / Pub-Sub (Kafka):** Toàn bộ đường phát sự kiện → fan-out → giao hàng → tổng hợp trạng thái.
  - **Bidirectional Push (WebSocket):** Presence heartbeat (30s/lần cập nhật TTL trong Redis) và đẩy In-app real-time.
- **Rate limiting & Throttling**:
  - **User API:** 60 req/phút/user cho Preferences & Device Token; 120 req/phút/user cho Inbox read (Sliding Window trên Redis).
  - **OTP / SMS Endpoint (Chống SMS Pumping):** Tối đa 3 SMS/10 phút/số điện thoại, 10 SMS/giờ/IP, kèm giới hạn theo tiền tố quốc gia và ngưỡng chi phí giờ (`spend cap`).
  - **Outbound Provider Rate Limit:** Distributed Token Bucket trên Redis theo từng `(provider, priority)` — ví dụ bảo lưu 20% quota cho `CRITICAL` để `BULK` không bao giờ ăn hết hạn mức.
- **Idempotency**:
  - Mọi yêu cầu trigger sự kiện bắt buộc gửi header `Idempotency-Key` (hoặc `event_id` duy nhất từ Outbox).
  - Ở tầng giao hàng, mỗi delivery có `notification_id` xác định cố định từ hash của `(campaign_id, user_id, channel, device_id)` và được truyền qua header `Idempotency-Key` tới provider nếu provider hỗ trợ.

## 6. 🔄 System / App Flow

### Flow 1: Publish Video Event → Transactional Outbox → Sharded Fan-out

Luồng dưới đây cho thấy Upload API hoàn tất ngay sau khi commit database + outbox, trong khi Fan-out Worker xử lý hàng triệu subscribers song song theo shard có checkpoint, đồng thời lọc Preferences, Quiet Hours và Presence.

```d2 interactive title="notification-system — Flow 1: Publish Event & Sharded Fan-out"
# viewport-height: 155vh
shape: sequence_diagram
Creator: "Creator"
API: "Upload API"
DB: "PostgreSQL\n(+ Outbox)" {
  icon: ./diagrams/icons/postgres.svg
}
Relay: "Outbox Relay\n(CDC)"
K: "Kafka (MSK)" {
  icon: ./diagrams/icons/msk.svg
}
Coord: "Fan-out\nCoordinator"
FW: "Fan-out\nWorker"
R: "Redis\n(Prefs/Cap/Presence)" {
  icon: ./diagrams/icons/redis.svg
}

Creator -> API: "POST /api/v1/videos\n(Publish video mới)"
API -> DB: "BEGIN TX: INSERT video +\nINSERT outbox_events"
DB -> API: "COMMIT OK" {style.stroke-dash: 4}
API -> Creator: "201 Created (không chờ notification)" {style.stroke-dash: 4}

Relay."[Relay,K] Async CDC"
Relay -> DB: "Đọc WAL / outbox chưa gửi"
Relay -> K: "Publish 1 event lên notif.events"

K -> Coord: "Consume video.published"
Coord -> DB: "INSERT notification_campaigns\n(ON CONFLICT event_id DO NOTHING)"
DB -> Coord: "campaign_id" {style.stroke-dash: 4}
Coord -> K: "Emit 64 shard tasks lên fanout.tasks"

K -> FW: "Consume shard_id (0..63)"
FW -> DB: "Đọc last_subscriber_id từ\nfanout_checkpoints"
DB -> FW: "cursor" {style.stroke-dash: 4}

group_1: "loop — lặp cho tới hết shard hoặc Kill Switch bật" {
  FW -> R: "Check campaign_cancelled:{id}"
  R -> FW: "false" {style.stroke-dash: 4}
  FW -> DB: "Keyset SELECT 1,000 subscribers\nWHERE shard_id=? AND id > cursor"
  DB -> FW: "batch 1,000 user_ids" {style.stroke-dash: 4}
  FW -> R: "Pipeline MGET prefs, presence,\nfrequency_cap cho 1,000 users"
  R -> FW: "User states" {style.stroke-dash: 4}

  group_2: "alt — phân nhánh cho từng user hợp lệ" {
    group_3: "if: Đang mở app (WebSocket active)" {
      style: {
        stroke-dash: 4
      }
      FW -> K: "Produce vào notif.inapp.realtime"
    }
    group_4: "else if: Đang trong Quiet Hours (BULK)" {
      style: {
        stroke-dash: 4
      }
      FW -> DB: "INSERT scheduled_notifications\n(deliver_at = 08:00 local)"
    }
    group_5: "else: Đủ điều kiện gửi ngay" {
      style: {
        stroke-dash: 4
      }
      FW -> K: "Produce batch vào notif.push.bulk\n/ notif.email.bulk (có pacing)"
    }
  }

  FW -> DB: "UPDATE fanout_checkpoints\nSET last_subscriber_id = last_id"
  DB -> FW: "OK" {style.stroke-dash: 4}
}
```

### Flow 2: Channel Delivery Worker — TTL, Idempotency, Retry và DLQ

Luồng thứ hai đi sâu vào một Push/Email/SMS Delivery Worker khi nhận job từ Kafka, đặc biệt là cách xử lý các kết quả khác nhau từ nhà cung cấp bên ngoài.

```d2 interactive title="notification-system — Flow 2: Delivery Worker, Retry & DLQ"
# viewport-height: 165vh
shape: sequence_diagram
K: "Kafka\n(Channel Topic)" {
  icon: ./diagrams/icons/msk.svg
}
W: "Delivery Worker\n(Push/Email/SMS)"
R: "Redis\n(Dedup & Limit)" {
  icon: ./diagrams/icons/redis.svg
}
T: "Template Svc"
P: "External Provider\n(APNs/FCM/SES/SMS)"
RK: "Kafka\n(Retry / DLQ)" {
  icon: ./diagrams/icons/msk.svg
}
ST: "Kafka\n(Delivery Status)" {
  icon: ./diagrams/icons/msk.svg
}

K -> W: "Consume DeliveryJob\n{notification_id, campaign_id, expires_at}"
W -> R: "Check Kill Switch &\nexpires_at > now?"

group_1: "alt — kiểm tra điều kiện sống của thông báo" {
  group_2: "if: Hết hạn (TTL) hoặc Campaign đã hủy" {
    style: {
      stroke-dash: 4
    }
    W -> ST: "Emit status = EXPIRED_OR_CANCELLED"
  }
  group_3: "else: Thông báo còn hiệu lực" {
    style: {
      stroke-dash: 4
    }
    W -> R: "SET NX dedup:{notification_id}:{attempt}\n(TTL 24h)"
    R -> W: "OK (claimed)" {style.stroke-dash: 4}
    W -> R: "Acquire Token Bucket\n(provider, priority, spend_cap)"
    R -> W: "Token granted" {style.stroke-dash: 4}
    W -> T: "Render localized payload\n(template_id, version, vars)"
    T -> W: "Rendered message" {style.stroke-dash: 4}
    W -> P: "HTTPS POST send\n(Idempotency-Key: notification_id)"

    group_4: "alt — phân loại phản hồi từ Provider" {
      group_5: "if: 202 Accepted (Thành công)" {
        style: {
          stroke-dash: 4
        }
        P -> W: "202 {provider_msg_id}" {style.stroke-dash: 4}
        W -> ST: "Emit status = ACCEPTED"
      }
      group_6: "else if: 410 Gone / UNREGISTERED (Lỗi vĩnh viễn)" {
        style: {
          stroke-dash: 4
        }
        P -> W: "410 UNREGISTERED" {style.stroke-dash: 4}
        W -> ST: "Emit status = PERMANENT_FAILURE\n+ deactivate device_token"
      }
      group_7: "else if: 429 / 5xx / Timeout & còn lượt retry" {
        style: {
          stroke-dash: 4
        }
        P -> W: "429 Retry-After / Timeout" {style.stroke-dash: 4}
        W -> RK: "Push vào Tiered Retry Topic\n(backoff + full jitter)"
        W -> ST: "Emit status = RETRYING"
      }
      group_8: "else: Hết lượt retry (maxAttempts)" {
        style: {
          stroke-dash: 4
        }
        W -> RK: "Push vào DLQ (redact PII/OTP)"
        W -> ST: "Emit status = DEAD_LETTERED"
      }
    }
  }
}
```

### Error handling & Edge cases

| Tình huống lỗi / Edge case | HTTP / Error Code | Hành vi hệ thống |
|---|---|---|
| Sự kiện gửi trùng từ Domain API hoặc Outbox Relay | `200 OK` (idempotent) / Unique violation | `INSERT ... ON CONFLICT (event_id) DO NOTHING`; trả về `campaign_id` hiện có, không tạo chiến dịch thứ hai |
| Request gửi OTP vượt giới hạn chống SMS Pumping | `429 Too Many Requests` | Chặn ngay tại API Gateway/SMS Service, ghi audit log cảnh báo gian lận, không đẩy vào SMS Queue |
| Provider trả `429` kèm `Retry-After` hoặc `5xx` / timeout | `429`, `502`, `503`, `504` | Đẩy sang Tiered Retry Topic theo bậc backoff + full jitter; nếu là SMS/Email và lỗi kéo dài > 2 phút, Circuit Breaker chuyển sang provider dự phòng |
| Provider trả token không tồn tại (`410` / `UNREGISTERED`) hoặc Email Hard Bounce | `410 Gone` / Webhook Bounce | **Không retry**; vô hiệu hóa ngay `device_token` hoặc đưa email vào `suppression_list` để bảo vệ sender reputation |
| Thông báo hết hạn trong lúc queue bị nghẽn (OTP > 3 phút, livestream đã xong) | Internal `EXPIRED` | Worker kiểm tra `expires_at` ngay trước khi gọi provider, bỏ qua và ghi trạng thái `EXPIRED` |
| Redis tạm thời không truy cập được | Fallback degraded mode | Làn `CRITICAL` (OTP) fallback đọc DB + local in-memory rate limit bảo thủ để không làm gián đoạn đăng nhập; làn `BULK` tạm pause consumer chờ Redis hồi phục để tránh vượt quota provider |
| User A logout quên hủy token rồi User B login trên cùng thiết bị | Conflict ownership | API đăng ký token ghi đè `user_id` mới một cách nguyên tử trên cùng `device_token` và xóa cache cũ ngay lập tức |
| Creator xóa video sau khi fan-out mới chạy được 20% | `POST /campaigns/{id}/cancel` | Đặt cờ `campaign_cancelled:{id} = 1` trong Redis (TTL 24h) + cập nhật DB; mọi Fan-out Worker và Delivery Worker dừng tức thì trong < 2s |

## 7. 📡 API Modeling

### Endpoint Definitions

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| `POST` | `/api/v1/internal/notifications/events` | Internal mTLS + Service Token | Tiếp nhận trực tiếp sự kiện thông báo (cho service không dùng chung DB Outbox) |
| `POST` | `/api/v1/internal/campaigns/{campaignId}/cancel` | Internal / Ops RBAC | Kích hoạt **Kill Switch** hủy chiến dịch đang fan-out/đang gửi |
| `PUT` | `/api/v1/users/me/notification-preferences` | User JWT | Cập nhật tùy chọn bật/tắt theo kênh, loại sự kiện và khung Quiet Hours |
| `POST` | `/api/v1/users/me/devices` | User JWT | Đăng ký hoặc gắn lại quyền sở hữu `device_token` (APNs/FCM) |
| `DELETE` | `/api/v1/users/me/devices/{deviceId}` | User JWT | Hủy liên kết `device_token` khi người dùng đăng xuất |
| `GET` | `/api/v1/users/me/notifications` | User JWT | Lấy danh sách In-app Inbox (cursor-based pagination) |
| `PATCH` | `/api/v1/users/me/notifications/{notificationId}/read` | User JWT | Đánh dấu đã đọc và đồng bộ badge qua WebSocket tới các thiết bị khác |
| `GET` | `/api/v1/internal/deliveries/{notificationId}` | Support RBAC | Tra cứu trạng thái giao hàng end-to-end cho đội Support |

### Request/Response Examples

```protocol-exchange
title: POST /api/v1/internal/notifications/events
variants:
  - id: accepted
    title: 202 Accepted (Tạo campaign mới)
    request:
      method: POST
      url: /api/v1/internal/notifications/events
      headers:
        - id: h-host-1
          name: Host
          value: internal-notif.example.invalid
        - id: h-ct-1
          name: Content-Type
          value: application/json
        - id: h-auth-1
          name: Authorization
          value: Bearer svc_eyJhbGciOiJSUzI1NiIs...
        - id: h-idem-1
          name: Idempotency-Key
          value: evt_video_pub_9007199254740993
      body:
        kind: json
        json: |
          {
            "event_id": "evt_video_pub_9007199254740993",
            "event_type": "VIDEO_PUBLISHED",
            "priority": "BULK",
            "source_actor_id": "100450200192837465",
            "target_audience": {
              "mode": "CREATOR_SUBSCRIBERS",
              "creator_id": "100450200192837465"
            },
            "template_id": "new_video_v2",
            "template_version": 2,
            "variables": {
              "creator_name": "Tech Deep Dive",
              "video_id": "vid_8829104",
              "video_title": "Cách thiết kế Notification System triệu user"
            },
            "channels": ["PUSH", "IN_APP", "EMAIL"],
            "collapse_key": "creator_100450200192837465_new_video",
            "ttl_seconds": 21600
          }
    response:
      status: 202
      statusText: Accepted
      headers:
        - id: r-ct-1
          name: Content-Type
          value: application/json
      body:
        kind: json
        json: |
          {
            "campaign_id": "cmp_01J9Z4K8M2P7Q3R5S6T8V9W0XY",
            "event_id": "evt_video_pub_9007199254740993",
            "status": "QUEUED_FOR_FANOUT",
            "estimated_shards": 64,
            "expires_at": "2026-04-19T18:00:00Z"
          }
  - id: rate-limited
    title: 429 Too Many Requests (SMS Pumping Guard)
    request:
      method: POST
      url: /api/v1/internal/notifications/events
      headers:
        - id: h-host-2
          name: Host
          value: internal-notif.example.invalid
        - id: h-ct-2
          name: Content-Type
          value: application/json
        - id: h-auth-2
          name: Authorization
          value: Bearer svc_eyJhbGciOiJSUzI1NiIs...
        - id: h-idem-2
          name: Idempotency-Key
          value: evt_otp_9007199254741009
      body:
        kind: json
        json: |
          {
            "event_id": "evt_otp_9007199254741009",
            "event_type": "AUTH_OTP",
            "priority": "CRITICAL",
            "target_audience": {
              "mode": "SINGLE_USER",
              "user_id": "200881920019283746"
            },
            "template_id": "login_otp",
            "template_version": 1,
            "variables": {
              "otp_code": "482910"
            },
            "channels": ["SMS"],
            "ttl_seconds": 180
          }
    response:
      status: 429
      statusText: Too Many Requests
      headers:
        - id: r-ct-2
          name: Content-Type
          value: application/json
        - id: r-ra-2
          name: Retry-After
          value: "300"
      body:
        kind: json
        json: |
          {
            "timestamp": "2026-04-19T12:00:00Z",
            "status": 429,
            "error": "Too Many Requests",
            "code": "SMS_RATE_LIMIT_EXCEEDED",
            "message": "Destination phone exceeded 3 OTP requests within 10 minutes",
            "path": "/api/v1/internal/notifications/events"
          }
```

```protocol-exchange
title: PUT /api/v1/users/me/notification-preferences
variants:
  - id: updated
    title: 200 OK
    request:
      method: PUT
      url: /api/v1/users/me/notification-preferences
      headers:
        - id: h-host-1
          name: Host
          value: api.platform.example.invalid
        - id: h-ct-1
          name: Content-Type
          value: application/json
        - id: h-auth-1
          name: Authorization
          value: Bearer usr_eyJhbGciOiJSUzI1NiIs...
      body:
        kind: json
        json: |
          {
            "timezone": "Asia/Ho_Chi_Minh",
            "quiet_hours": {
              "enabled": true,
              "start_local": "23:00",
              "end_local": "07:30"
            },
            "max_bulk_push_per_day": 5,
            "channels": {
              "VIDEO_PUBLISHED": {
                "push": true,
                "email": false,
                "in_app": true
              },
              "COMMENT_REPLY": {
                "push": true,
                "email": false,
                "in_app": true
              }
            }
          }
    response:
      status: 200
      statusText: OK
      headers:
        - id: r-ct-1
          name: Content-Type
          value: application/json
      body:
        kind: json
        json: |
          {
            "user_id": "200881920019283746",
            "timezone": "Asia/Ho_Chi_Minh",
            "quiet_hours": {
              "enabled": true,
              "start_local": "23:00",
              "end_local": "07:30"
            },
            "max_bulk_push_per_day": 5,
            "updated_at": "2026-04-19T12:05:00Z"
          }
```

```protocol-exchange
title: GET /api/v1/users/me/notifications?cursor=7199281726354410020&limit=20
variants:
  - id: inbox-ok
    title: 200 OK (In-app Inbox)
    request:
      method: GET
      url: /api/v1/users/me/notifications?cursor=7199281726354410020&limit=20
      headers:
        - id: h-host-1
          name: Host
          value: api.platform.example.invalid
        - id: h-auth-1
          name: Authorization
          value: Bearer usr_eyJhbGciOiJSUzI1NiIs...
    response:
      status: 200
      statusText: OK
      headers:
        - id: r-ct-1
          name: Content-Type
          value: application/json
      body:
        kind: json
        json: |
          {
            "unread_count": 3,
            "items": [
              {
                "notification_id": "7199281726354410018",
                "event_type": "VIDEO_PUBLISHED",
                "title": "Tech Deep Dive vừa đăng video mới",
                "body": "Cách thiết kế Notification System triệu user",
                "deep_link": "/watch/vid_8829104",
                "is_read": false,
                "created_at": "2026-04-19T11:58:12Z"
              }
            ],
            "next_cursor": "7199281726354410018",
            "has_more": true
          }
```

### Error Response Format

Mọi lỗi REST API trả về một cấu trúc thống nhất để client và đội Support xử lý tự động:

```json
{
  "timestamp": "2026-04-19T12:00:00Z",
  "status": 400,
  "error": "Bad Request",
  "code": "INVALID_TEMPLATE_VARIABLES",
  "message": "Missing required variable 'video_title' for template new_video_v2",
  "path": "/api/v1/internal/notifications/events"
}
```

### Pagination / Filtering / Sorting
- **Strategy:** Dùng **cursor-based pagination** theo Snowflake ID tăng dần theo thời gian (`WHERE user_id = ? AND notification_id < ? ORDER BY notification_id DESC LIMIT 20`). Tránh `OFFSET` vì khi có thông báo mới chèn vào đầu danh sách, `OFFSET` sẽ gây lặp hoặc bỏ sót mục khi người dùng cuộn.
- **Filter / Sort:** Hỗ trợ filter `unread_only=true`, `event_type=VIDEO_PUBLISHED`, mặc định sắp xếp mới nhất trước (`notification_id DESC`).

### API Versioning
- **Strategy:** Path-based (`/api/v1/...`), riêng template payload còn có trường `template_version` độc lập để job cũ nằm trong queue vẫn render khớp schema cũ khi triển khai phiên bản mới.
- **Deprecation policy:** Hỗ trợ song song hai phiên bản API tối thiểu 6 tháng, phát cảnh báo qua header `Deprecation` và `Sunset` trước khi ngắt phiên bản cũ.

## 8. 🗄️ Data Modeling

### Database Schema

```sql
-- 1. Bảng Outbox nằm trong Business DB (hoặc Domain DB) để commit nguyên tử
CREATE TABLE outbox_events (
    event_id        UUID PRIMARY KEY,
    aggregate_type  VARCHAR(64) NOT NULL,
    aggregate_id    VARCHAR(128) NOT NULL,
    event_type      VARCHAR(80) NOT NULL,
    payload         JSONB NOT NULL,
    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Bảng chiến dịch / sự kiện thông báo (lưu nội dung gốc 1 lần duy nhất)
CREATE TABLE notification_campaigns (
    campaign_id      UUID PRIMARY KEY,
    event_id         VARCHAR(128) NOT NULL UNIQUE,
    event_type       VARCHAR(80) NOT NULL,
    priority         VARCHAR(16) NOT NULL CHECK (priority IN ('CRITICAL', 'INTERACTIVE', 'BULK')),
    template_id      VARCHAR(80) NOT NULL,
    template_version INTEGER NOT NULL,
    payload_data     JSONB NOT NULL,
    collapse_key     VARCHAR(128),
    status           VARCHAR(24) NOT NULL CHECK (status IN ('ACTIVE', 'CANCELLED', 'COMPLETED')),
    expires_at       TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Checkpoint tiến độ fan-out theo từng shard
CREATE TABLE fanout_checkpoints (
    campaign_id        UUID NOT NULL REFERENCES notification_campaigns(campaign_id),
    shard_id           SMALLINT NOT NULL CHECK (shard_id >= 0 AND shard_id < 64),
    last_subscriber_id BIGINT NOT NULL DEFAULT 0,
    processed_count    BIGINT NOT NULL DEFAULT 0,
    status             VARCHAR(16) NOT NULL CHECK (status IN ('RUNNING', 'DONE', 'CANCELLED')),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (campaign_id, shard_id)
);

-- 4. Tùy chọn nhận thông báo của người dùng
CREATE TABLE user_preferences (
    user_id               BIGINT PRIMARY KEY,
    timezone              VARCHAR(64) NOT NULL DEFAULT 'UTC',
    quiet_hours_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    quiet_start_local     TIME NOT NULL DEFAULT '23:00',
    quiet_end_local       TIME NOT NULL DEFAULT '07:00',
    max_bulk_push_per_day SMALLINT NOT NULL DEFAULT 10,
    channel_settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Thiết bị và Push Token (1 user có nhiều thiết bị; mỗi token thuộc duy nhất 1 user)
CREATE TABLE user_devices (
    device_id      UUID PRIMARY KEY,
    user_id        BIGINT NOT NULL,
    platform       VARCHAR(16) NOT NULL CHECK (platform IN ('IOS', 'ANDROID', 'WEB')),
    device_token   VARCHAR(512) NOT NULL UNIQUE,
    app_version    VARCHAR(32),
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Danh sách chặn gửi Email/SMS (Hard Bounce, Spam Complaint, Opt-out)
CREATE TABLE suppression_list (
    destination_hash CHAR(64) PRIMARY KEY, -- SHA-256 của email hoặc SĐT chuẩn hóa
    channel          VARCHAR(16) NOT NULL CHECK (channel IN ('EMAIL', 'SMS')),
    reason           VARCHAR(32) NOT NULL CHECK (reason IN ('HARD_BOUNCE', 'SPAM_COMPLAINT', 'UNSUBSCRIBED')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Thông báo hẹn giờ (Quiet Hours / Scheduled Replay)
CREATE TABLE scheduled_notifications (
    schedule_id      UUID PRIMARY KEY,
    campaign_id      UUID NOT NULL REFERENCES notification_campaigns(campaign_id),
    user_id          BIGINT NOT NULL,
    channel          VARCHAR(16) NOT NULL,
    deliver_at       TIMESTAMPTZ NOT NULL,
    status           VARCHAR(16) NOT NULL CHECK (status IN ('PENDING', 'DISPATCHED', 'CANCELLED')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Trạng thái giao hàng từng thông báo (Partition theo ngày, hot retention 14 ngày)
CREATE TABLE notification_deliveries (
    notification_id     BIGINT NOT NULL,
    campaign_id         UUID NOT NULL,
    user_id             BIGINT NOT NULL,
    device_id           UUID,
    channel             VARCHAR(16) NOT NULL CHECK (channel IN ('PUSH', 'EMAIL', 'SMS', 'IN_APP')),
    status              VARCHAR(24) NOT NULL CHECK (status IN ('QUEUED', 'ACCEPTED', 'DELIVERED', 'FAILED', 'EXPIRED', 'DEAD_LETTERED')),
    attempt_count       SMALLINT NOT NULL DEFAULT 0,
    provider_message_id VARCHAR(128),
    last_error_code     VARCHAR(64),
    is_read             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (created_at, notification_id)
) PARTITION BY RANGE (created_at);
```

### ER Diagram

```d2 interactive title="notification-system — ER Diagram"
direction: right

USER_PREFERENCES: {
  shape: sql_table
  "user_id": bigint {constraint: primary_key}
  "timezone": varchar
  "quiet_hours_enabled": boolean
  "quiet_start_local": time
  "quiet_end_local": time
  "max_bulk_push_per_day": smallint
  "channel_settings": jsonb
  "updated_at": timestamptz
}

USER_DEVICES: {
  shape: sql_table
  "device_id": uuid {constraint: primary_key}
  "user_id": bigint {constraint: foreign_key}
  "platform": varchar
  "device_token": varchar {constraint: unique}
  "app_version": varchar
  "is_active": boolean
  "last_seen_at": timestamptz
}

NOTIFICATION_CAMPAIGNS: {
  shape: sql_table
  "campaign_id": uuid {constraint: primary_key}
  "event_id": varchar {constraint: unique}
  "event_type": varchar
  "priority": varchar
  "template_id": varchar
  "template_version": int
  "payload_data": jsonb
  "collapse_key": varchar
  "status": varchar
  "expires_at": timestamptz
  "created_at": timestamptz
}

FANOUT_CHECKPOINTS: {
  shape: sql_table
  "campaign_id": uuid {constraint: [primary_key; foreign_key]}
  "shard_id": smallint {constraint: primary_key}
  "last_subscriber_id": bigint
  "processed_count": bigint
  "status": varchar
  "updated_at": timestamptz
}

SCHEDULED_NOTIFICATIONS: {
  shape: sql_table
  "schedule_id": uuid {constraint: primary_key}
  "campaign_id": uuid {constraint: foreign_key}
  "user_id": bigint {constraint: foreign_key}
  "channel": varchar
  "deliver_at": timestamptz
  "status": varchar
}

NOTIFICATION_DELIVERIES: {
  shape: sql_table
  "notification_id": bigint {constraint: primary_key}
  "campaign_id": uuid {constraint: foreign_key}
  "user_id": bigint {constraint: foreign_key}
  "device_id": uuid {constraint: foreign_key}
  "channel": varchar
  "status": varchar
  "attempt_count": smallint
  "provider_message_id": varchar
  "last_error_code": varchar
  "is_read": boolean
  "created_at": timestamptz
}

SUPPRESSION_LIST: {
  shape: sql_table
  "destination_hash": char {constraint: primary_key}
  "channel": varchar
  "reason": varchar
  "created_at": timestamptz
}

USER_PREFERENCES."user_id" <-> USER_DEVICES."user_id": "owns devices" {
  source-arrowhead: "1" {shape: cf-one-required}
  target-arrowhead: "0..N" {shape: cf-many}
}

USER_PREFERENCES."user_id" <-> NOTIFICATION_DELIVERIES."user_id": "receives" {
  source-arrowhead: "1" {shape: cf-one-required}
  target-arrowhead: "0..N" {shape: cf-many}
}

USER_PREFERENCES."user_id" <-> SCHEDULED_NOTIFICATIONS."user_id": "deferred for" {
  source-arrowhead: "1" {shape: cf-one-required}
  target-arrowhead: "0..N" {shape: cf-many}
}

NOTIFICATION_CAMPAIGNS."campaign_id" <-> FANOUT_CHECKPOINTS."campaign_id": "tracked by" {
  source-arrowhead: "1" {shape: cf-one-required}
  target-arrowhead: "0..N" {shape: cf-many}
}

NOTIFICATION_CAMPAIGNS."campaign_id" <-> SCHEDULED_NOTIFICATIONS."campaign_id": "schedules" {
  source-arrowhead: "1" {shape: cf-one-required}
  target-arrowhead: "0..N" {shape: cf-many}
}

NOTIFICATION_CAMPAIGNS."campaign_id" <-> NOTIFICATION_DELIVERIES."campaign_id": "fans out to" {
  source-arrowhead: "1" {shape: cf-one-required}
  target-arrowhead: "0..N" {shape: cf-many}
}

USER_DEVICES."device_id" <-> NOTIFICATION_DELIVERIES."device_id": "delivered to" {
  source-arrowhead: "1" {shape: cf-one-required}
  target-arrowhead: "0..N" {shape: cf-many}
}
```

> 📌 Lưu ý: `NOTIFICATION_DELIVERIES` là bảng partitioned nên khóa ngoại logic tới `USER_PREFERENCES`, `USER_DEVICES` và `NOTIFICATION_CAMPAIGNS` được bảo đảm ở tầng ứng dụng/event contract thay vì SQL foreign key ràng buộc cứng, nhằm giữ tốc độ batch-insert ở mức peak `[C1]`.

### Indexing Strategy

| Bảng | Index | Loại | Query pattern phục vụ |
|---|---|---|---|
| `outbox_events` | `idx_outbox_unpublished (created_at) WHERE published_at IS NULL` | Partial Index | Outbox Relay chỉ quét các dòng chưa xuất bản, giữ kích thước index cực nhỏ |
| `user_devices` | `idx_devices_user_active (user_id) WHERE is_active = TRUE` | Partial Composite | Lấy nhanh danh sách token còn sống khi fan-out |
| `user_devices` | `uq_devices_token (device_token)` | Unique Index | Đảm bảo một thiết bị chỉ thuộc 1 tài khoản (chống rò rỉ khi đổi tài khoản) |
| `scheduled_notifications` | `idx_sched_due (deliver_at) WHERE status = 'PENDING'` | Partial Index | Delayed Scheduler quét job đến giờ gửi mỗi phút |
| `notification_deliveries` | `idx_deliv_user_inbox (user_id, notification_id DESC) WHERE channel = 'IN_APP'` | Partial Composite | API lấy In-app Inbox cursor-based dưới 100ms |
| `notification_deliveries` | `idx_deliv_provider_msg (provider_message_id) WHERE provider_message_id IS NOT NULL` | Partial Index | Khớp webhook Delivered / Bounce từ Email/SMS provider |

### Partitioning / Sharding Strategy
- **`notification_deliveries`**: **Range partitioning theo ngày (`created_at`)**. Với 500M dòng/ngày (`~200GB/partition` gồm index), giữ 14 ngày tương đương `~2.8TB` hot storage `[C5]`. Hết 14 ngày chỉ cần export sang S3 Parquet rồi `DROP TABLE` partition cũ trong vài mili-giây.
- **`subscriptions` (ở Social/Creator DB đọc bởi Fan-out):** Phân mảnh logic theo `shard_id = hash(subscriber_id) % 64`, tạo composite index `(creator_id, shard_id, subscriber_id)` để 64 Fan-out Worker chạy song song không xung đột.
- **Ngưỡng sharding DB:** Khi tổng lượng delivery vượt ~1.5 tỷ dòng/ngày hoặc hot storage vượt 10TB, tách `notification_deliveries` sang PostgreSQL Citus (shard theo `user_id`) hoặc Cassandra/ScyllaDB.

### Data Retention Policy
- **`notification_deliveries` (hot PostgreSQL):** 14 ngày cho Push/Email/SMS status; riêng `IN_APP` giữ 90 ngày (hoặc tách bảng `inapp_inbox` giữ tối đa 200 thông báo gần nhất/user).
- **Cold archive (S3 Parquet):** Lưu 1 năm cho phân tích sản phẩm và audit pháp lý (`~9.1TB/năm` `[C6]`), chuyển S3 Intelligent-Tiering sau 90 ngày và Glacier sau 180 ngày.
- **`suppression_list`:** Giữ vĩnh viễn (trừ khi người dùng chủ động xác nhận opt-in lại qua double opt-in) để không bao giờ gửi lại vào email đã Hard Bounce hoặc tố cáo Spam.

> 💡 **Tại sao băm SHA-256 trong `suppression_list`?**
> Khi người dùng yêu cầu xóa tài khoản theo GDPR ("Right to be Forgotten"), bạn phải xóa địa chỉ email thô nhưng vẫn cần nhớ không được gửi lại email vào địa chỉ đã từng opt-out/bounce. Lưu `SHA-256(lowercase(email) + pepper)` giúp tuân thủ đồng thời cả hai yêu cầu.

## 9. ⚙️ Manager Classes / Services

### Service Decomposition
- **`notification-api-service`**: REST API nhận sự kiện, quản lý Preferences, Device Token, In-app Inbox và Kill Switch.
- **`fanout-coordinator-service`**: Tiêu thụ `notif.events`, tạo campaign, pre-warm cache tài nguyên liên quan và phát 64 shard task.
- **`fanout-worker-service`**: Tiêu thụ `fanout.tasks`, đọc subscribers theo keyset + checkpoint, áp dụng Preferences/Quiet Hours/Presence/Frequency Cap và pacing vào các topic kênh.
- **`push-delivery-worker` / `email-delivery-worker` / `sms-delivery-worker`**: 3 microservice độc lập cho 3 kênh, quản lý riêng timeout, connection pool, circuit breaker, multi-provider failover và retry/DLQ.
- **`inapp-gateway-service`**: Quản lý kết nối WebSocket, cập nhật Presence trên Redis và đẩy In-app notification + đồng bộ trạng thái đã đọc.
- **`status-aggregator-service`**: Nhận status event từ Kafka và webhook từ provider, batch-upsert vào PostgreSQL, cập nhật `suppression_list` và vô hiệu hóa token chết.

### Core Service Classes & Responsibilities
- `NotificationEventController` (`@RestController`): Validate input, kiểm tra `Idempotency-Key` và rate limit chống SMS Pumping.
- `ShardedFanoutWorker` (`@Service`): Chạy vòng lặp keyset pagination, kiểm tra Kill Switch, lọc theo batch bằng Redis pipeline và lưu checkpoint.
- `PushDeliveryWorker` (`@Service`): Kiểm tra TTL/hủy chiến dịch, claim dedup, xin Redis Token Bucket, render template, gọi Push Gateway kèm `Idempotency-Key`, phân loại kết quả `202 / 410 / 429 / DLQ`.
- `DistributedRateLimiter` (`@Component`): Thực thi Lua script Token Bucket trên Redis để đảm bảo atomic check-and-decrement giữa hàng chục worker pod.
- `DeviceTokenService` (`@Service`): Đăng ký token theo cơ chế atomic upsert chuyển quyền sở hữu sang `user_id` mới và hủy liên kết khi logout.

### Backend Code Example (Java / Spring Boot)

Đoạn mã dưới đây trình bày luồng xử lý đầy đủ của `PushDeliveryWorker`, gom toàn bộ các chốt chặn an toàn ngoài production vào đúng thứ tự thực thi:

```code-walkthrough
title: PushDeliveryWorker — luồng giao hàng an toàn và phân loại lỗi
language: java
snapshots:
  - id: worker
    title: PushDeliveryWorker.java
    code: |
      @Service
      @RequiredArgsConstructor
      @Slf4j
      public class PushDeliveryWorker {

          private final CampaignGuardCache campaignGuardCache;
          private final RedisDedupStore dedupStore;
          private final DistributedRateLimiter rateLimiter;
          private final TemplateRenderer templateRenderer;
          private final PushProviderClient pushClient;
          private final RetryDispatcher retryDispatcher;
          private final DeliveryStatusPublisher statusPublisher;

          @KafkaListener(
              topics = {"notif.push.critical", "notif.push.bulk"},
              groupId = "push-delivery-workers"
          )
          public void onMessage(PushDeliveryJob job) {
              long now = System.currentTimeMillis();

              // 1. Chặn sớm thông báo đã hết TTL hoặc chiến dịch vừa bị Kill Switch
              if (now > job.getExpiresAtMs()
                      || campaignGuardCache.isCancelled(job.getCampaignId())) {
                  statusPublisher.emit(job, DeliveryStatus.EXPIRED_OR_CANCELLED, null);
                  return;
              }

              // 2. Claim duy nhất cho cặp (notificationId, attempt) để tránh xử lý trùng
              if (!dedupStore.tryClaim(job.getNotificationId(), job.getAttempt(), Duration.ofHours(24))) {
                  log.debug("Duplicate delivery skipped: {}", job.getNotificationId());
                  return;
              }

              // 3. Xin quota từ distributed rate limiter (ưu tiên làn CRITICAL)
              if (!rateLimiter.tryAcquire("fcm", job.getPriority())) {
                  retryDispatcher.scheduleWithJitter(job, job.getAttempt(), Duration.ofSeconds(5));
                  return;
              }

              // 4. Render payload theo đúng templateVersion và locale của user
              RenderedPush payload = templateRenderer.renderPush(
                  job.getTemplateId(), job.getTemplateVersion(), job.getLocale(), job.getVariables()
              );

              // 5. Gọi Push Gateway kèm Idempotency-Key ổn định qua mọi lần retry
              ProviderResponse res = pushClient.send(
                  job.getNotificationId().toString(),
                  job.getDeviceToken(),
                  payload,
                  job.getCollapseKey(),
                  Math.max(1, (job.getExpiresAtMs() - now) / 1000)
              );

              // 6. Phân loại kết quả: 202 Accepted / 410 Token chết / Retry / DLQ
              if (res.isAccepted()) {
                  statusPublisher.emitAccepted(job, res.getProviderMessageId());
                  return;
              }

              if (res.isUnregisteredToken()) {
                  statusPublisher.emitPermanentFailureAndDeactivateToken(
                      job, job.getDeviceToken(), res.getErrorCode()
                  );
                  return;
              }

              if (res.isRetryable() && job.getAttempt() < job.getMaxAttempts()) {
                  Duration delay = retryDispatcher.computeBackoffWithJitter(
                      job.getAttempt(), res.getRetryAfter()
                  );
                  retryDispatcher.scheduleNextAttempt(job, job.getAttempt() + 1, delay);
                  statusPublisher.emit(job, DeliveryStatus.RETRYING, res.getErrorCode());
                  return;
              }

              // 7. Hết lượt retry hoặc lỗi payload không phục hồi được → DLQ (đã redact dữ liệu nhạy cảm)
              retryDispatcher.publishToDlq(job.redactedCopy(), res.getStatusCode(), res.getErrorCode());
              statusPublisher.emit(job, DeliveryStatus.DEAD_LETTERED, res.getErrorCode());
          }
      }
steps:
  - id: guard-ttl
    title: Kiểm tra TTL và Kill Switch trước khi làm bất kỳ việc gì
    description: Nếu thông báo đã quá expiresAtMs (ví dụ OTP hết hạn) hoặc vận hành vừa bật Kill Switch cho chiến dịch, dừng ngay để không đốt quota mạng.
    snapshot: worker
    ranges:
      - - 21
        - 26
  - id: dedup
    title: Claim khóa idempotency nội bộ trên Redis
    description: Khóa theo cặp (notificationId, attempt) với TTL 24 giờ để chặn hai worker gửi song song khi Kafka rebalance hoặc redeliver.
    snapshot: worker
    ranges:
      - - 28
        - 32
  - id: rate-limit
    title: Xin hạn mức từ Distributed Rate Limiter
    description: Token Bucket dùng chung trên Redis bảo đảm tổng lưu lượng từ mọi pod không vượt quota của APNs/FCM và bảo lưu tài nguyên cho làn CRITICAL.
    snapshot: worker
    ranges:
      - - 34
        - 38
  - id: send-provider
    title: Render đúng phiên bản template và gửi kèm Idempotency-Key
    description: Truyền đúng templateVersion để job cũ không lỗi khi cập nhật mẫu mới, và truyền notificationId làm Idempotency-Key tới provider kèm TTL còn lại.
    snapshot: worker
    ranges:
      - - 40
        - 52
  - id: permanent-fail
    title: Vô hiệu hóa ngay Device Token khi gặp 410 / UNREGISTERED
    description: Lỗi token hết hạn là lỗi vĩnh viễn — tuyệt đối không retry mà phát sự kiện tắt token để giảm nhiễu cho các chiến dịch tiếp theo.
    snapshot: worker
    ranges:
      - - 60
        - 65
  - id: retry-dlq
    title: Retry có backoff + full jitter hoặc đẩy sang DLQ đã redact
    description: Tôn trọng Retry-After từ provider cho lỗi 429/5xx; khi vượt maxAttempts thì redact dữ liệu nhạy cảm rồi đẩy vào DLQ để điều tra.
    snapshot: worker
    ranges:
      - - 67
        - 77
```

### Frontend Code Example (React + TypeScript)

Component React quản lý cài đặt thông báo (kèm Quiet Hours tự lấy múi giờ trình duyệt) và hook xử lý đăng xuất an toàn (gỡ `device_token` trước khi xóa session để tránh rò rỉ tài khoản):

```tsx
import React, { useEffect, useState } from 'react';

interface ChannelPref {
  push: boolean;
  email: boolean;
  in_app: boolean;
}

interface NotificationPrefs {
  timezone: string;
  quiet_hours: {
    enabled: boolean;
    start_local: string;
    end_local: string;
  };
  max_bulk_push_per_day: number;
  channels: Record<string, ChannelPref>;
}

export function NotificationSettingsPanel() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/users/me/notification-preferences', { credentials: 'include' })
      .then((res) => res.json())
      .then((data: NotificationPrefs) => setPrefs(data))
      .catch(() => setStatusMessage('Không tải được cài đặt thông báo.'));
  }, []);

  async function handleSave(nextPrefs: NotificationPrefs) {
    setSaving(true);
    setStatusMessage(null);
    try {
      const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || nextPrefs.timezone;
      const res = await fetch('/api/v1/users/me/notification-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...nextPrefs, timezone: detectedTz }),
      });
      if (!res.ok) throw new Error('Update failed');
      const updated = (await res.json()) as NotificationPrefs;
      setPrefs(updated);
      setStatusMessage('Đã lưu tùy chọn thông báo.');
    } catch {
      setStatusMessage('Lưu thất bại, vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  }

  if (!prefs) return <p>{statusMessage ?? 'Đang tải cài đặt...'}</p>;

  const videoPref = prefs.channels.VIDEO_PUBLISHED ?? { push: true, email: false, in_app: true };

  return (
    <section aria-label="Cài đặt thông báo">
      <h3>Thông báo video mới từ kênh đã đăng ký</h3>
      <label>
        <input
          type="checkbox"
          checked={videoPref.push}
          onChange={(e) =>
            setPrefs({
              ...prefs,
              channels: {
                ...prefs.channels,
                VIDEO_PUBLISHED: { ...videoPref, push: e.target.checked },
              },
            })
          }
        />
        Nhận Push Notification
      </label>

      <h3>Giờ yên tĩnh (Quiet Hours — {prefs.timezone})</h3>
      <label>
        <input
          type="checkbox"
          checked={prefs.quiet_hours.enabled}
          onChange={(e) =>
            setPrefs({
              ...prefs,
              quiet_hours: { ...prefs.quiet_hours, enabled: e.target.checked },
            })
          }
        />
        Hoãn thông báo không khẩn từ {prefs.quiet_hours.start_local} đến {prefs.quiet_hours.end_local}
      </label>

      <button type="button" disabled={saving} onClick={() => handleSave(prefs)}>
        {saving ? 'Đang lưu...' : 'Lưu cài đặt'}
      </button>
      {statusMessage && <p role="status">{statusMessage}</p>}
    </section>
  );
}

/** Gỡ liên kết device_token trước khi đăng xuất để tránh rò rỉ thông báo sang tài khoản sau. */
export async function logoutAndUnlinkDevice(deviceId: string): Promise<void> {
  await fetch(`/api/v1/users/me/devices/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
    credentials: 'include',
  }).catch(() => {
    // Fallback vẫn được backend bảo vệ khi tài khoản mới đăng ký lại cùng device_token
  });
  await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
}
```

### Service Communication Patterns
- **Sync (REST / gRPC):** API Gateway → Notification API; Delivery Worker → Template Service (hoặc nhúng template cache cục bộ để giảm thêm 1 hop mạng); Delivery Worker → External Provider qua Egress Proxy.
- **Async (Kafka):** Outbox Relay → `notif.events` → Fan-out Coordinator → `fanout.tasks` → Fan-out Workers → Channel Topics → Delivery Workers → Retry/DLQ & `notif.delivery.status` → Status Aggregator.
- **Shared Libraries:** `notification-contract-models` (Avro/Protobuf schema cho Kafka events), `notification-observability-starter` (correlation ID `campaign_id`, `notification_id`, `trace_id`).

## 10. 🏛️ Architecture Design

Hệ thống theo kiến trúc **Event-Driven Microservices** triển khai trên AWS EKS, tối ưu riêng hai đường nóng:
- **Critical Path (OTP/Security):** Đi qua topic `*.critical` riêng, dedicated worker pods luôn ấm, bỏ qua Quiet Hours và Frequency Cap, đạt p95 < 2s.
- **Bulk Path (Video 1M–10M subscribers):** Đi qua Sharded Fan-out + Pacing có kiểm soát tốc độ để vừa giữ SLA 5–15 phút, vừa không đánh sập Video API/CDN khi người dùng bấm mở đồng loạt.

### Architecture Diagram

```d2 interactive title="notification-system — Kiến trúc triển khai AWS"
direction: down

Internet: "Internet & External Providers" {
}
AWS_Edge: "AWS Edge" {
}
AWS_VPC: "AWS VPC (ap-southeast-1, Multi-AZ)" {
}
AWS_VPC.Public_Subnet: "Public Subnet" {
}
AWS_VPC.EKS: "EKS Cluster" {
  icon: ./diagrams/icons/eks.svg
}
AWS_VPC.EKS.Control_Plane: "API & Fan-out Pods" {
}
AWS_VPC.EKS.Channel_Pools: "Isolated Channel Worker Pools" {
}
AWS_VPC.EKS.Egress: "Egress Guard" {
}
AWS_VPC.Data_Layer: "Data & Streaming Layer" {
}
AWS_VPC.Data_Layer.RDS_Cluster: "RDS PostgreSQL (Multi-AZ)" {
  icon: ./diagrams/icons/rds.svg
}
AWS_VPC.Data_Layer.Redis_Cluster: "ElastiCache Redis Cluster" {
  icon: ./diagrams/icons/redis.svg
}
AWS_VPC.Data_Layer.MSK_Cluster: "Amazon MSK (Kafka)" {
  icon: ./diagrams/icons/msk.svg
}
AWS_VPC.Observability: "Observability" {
}

Internet.Users: "Mobile / Web Clients"
Internet.APNsFCM: "APNs / FCM"
Internet.EmailP: "SES / SendGrid\n(IP Transactional & Bulk)"
Internet.SmsP: "Twilio / Vonage"

AWS_Edge.R53: "Route53\n(DNS)" {
  icon: ./diagrams/icons/route53.svg
}
AWS_Edge.CF: "CloudFront\n(Thumbnails / Static)" {
  icon: ./diagrams/icons/cloudfront.svg
}
AWS_Edge.WAF: "AWS WAF\n(Bot & OTP Flood Shield)" {
  icon: ./diagrams/icons/waf.svg
}

AWS_VPC.Public_Subnet.ALB: "ALB\n(HTTPS & WSS)" {
  icon: ./diagrams/icons/load-balancer.svg
}
AWS_VPC.Public_Subnet.NAT: "NAT Gateways\n(Dedicated EIPs)"

AWS_VPC.EKS.APIGW: "API Gateway Pods\n(4-16 pods)"
AWS_VPC.EKS.Control_Plane.NotifAPI: "Notification API\n(4-12 pods)"
AWS_VPC.EKS.Control_Plane.FanoutCoord: "Fan-out Coordinator\n(2-4 pods)"
AWS_VPC.EKS.Control_Plane.FanoutW: "Sharded Fan-out Workers\n(8-32 pods)"
AWS_VPC.EKS.Control_Plane.StatusAgg: "Status Aggregator\n(4-12 pods)"

AWS_VPC.EKS.Channel_Pools.PushW: "Push Workers\n(Critical 4 + Bulk 8-40 pods)"
AWS_VPC.EKS.Channel_Pools.EmailW: "Email Workers\n(4-16 pods)"
AWS_VPC.EKS.Channel_Pools.SmsW: "SMS Workers\n(2-8 pods, Spend Cap)"
AWS_VPC.EKS.Channel_Pools.InappW: "In-app WS Gateway\n(6-24 pods)"

AWS_VPC.EKS.Egress.Proxy: "Egress Guard Proxy\n(Allowlist, mTLS, Circuit Breaker)"

AWS_VPC.Data_Layer.RDS_Cluster.PG_P: "Primary\n(db.r6g.4xlarge, 4TB gp3)"
AWS_VPC.Data_Layer.RDS_Cluster.PG_R1: "Read Replica 1\n(Inbox & Prefs)"
AWS_VPC.Data_Layer.RDS_Cluster.PG_R2: "Read Replica 2\n(Fan-out & Support)"

AWS_VPC.Data_Layer.Redis_Cluster.RS1: "Shards 1-3\n(Dedup 24h & Rate Limit)"
AWS_VPC.Data_Layer.Redis_Cluster.RS2: "Shards 4-6\n(Prefs, Presence, Kill Switch)"

AWS_VPC.Data_Layer.MSK_Cluster.T1: "notif.events + fanout.tasks\n(64 partitions)"
AWS_VPC.Data_Layer.MSK_Cluster.T2: "Channel & Priority Topics\n(push / email / sms / inapp)"
AWS_VPC.Data_Layer.MSK_Cluster.T3: "Retry Topics + DLQ +\nnotif.delivery.status"

AWS_VPC.Data_Layer.S3: "S3 Bucket\n(Parquet Audit & Templates)" {
  icon: ./diagrams/icons/s3.svg
}

AWS_VPC.Observability.CW: "CloudWatch" {
  icon: ./diagrams/icons/cloudwatch.svg
}
AWS_VPC.Observability.Prom: "Prometheus + Grafana"
AWS_VPC.Observability.ELK: "OpenSearch (ELK)"
AWS_VPC.Observability.Jaeger: "Jaeger / X-Ray"

Internet.Users -> AWS_Edge.R53
AWS_Edge.R53 -> AWS_Edge.CF
AWS_Edge.R53 -> AWS_Edge.WAF
AWS_Edge.CF -> AWS_VPC.Data_Layer.S3
AWS_Edge.WAF -> AWS_VPC.Public_Subnet.ALB
AWS_VPC.Public_Subnet.ALB -> AWS_VPC.EKS.APIGW
AWS_VPC.EKS.APIGW -> AWS_VPC.EKS.Control_Plane.NotifAPI
AWS_VPC.EKS.APIGW -> AWS_VPC.EKS.Channel_Pools.InappW

AWS_VPC.EKS.Control_Plane.NotifAPI -> AWS_VPC.Data_Layer.RDS_Cluster.PG_P
AWS_VPC.EKS.Control_Plane.NotifAPI -> AWS_VPC.Data_Layer.RDS_Cluster.PG_R1
AWS_VPC.EKS.Control_Plane.NotifAPI -> AWS_VPC.Data_Layer.Redis_Cluster.RS2
AWS_VPC.EKS.Control_Plane.NotifAPI -> AWS_VPC.Data_Layer.MSK_Cluster.T1

AWS_VPC.Data_Layer.MSK_Cluster.T1 -> AWS_VPC.EKS.Control_Plane.FanoutCoord
AWS_VPC.EKS.Control_Plane.FanoutCoord -> AWS_VPC.Data_Layer.RDS_Cluster.PG_P
AWS_VPC.Data_Layer.MSK_Cluster.T1 -> AWS_VPC.EKS.Control_Plane.FanoutW
AWS_VPC.EKS.Control_Plane.FanoutW -> AWS_VPC.Data_Layer.RDS_Cluster.PG_R2
AWS_VPC.EKS.Control_Plane.FanoutW -> AWS_VPC.Data_Layer.Redis_Cluster.RS2
AWS_VPC.EKS.Control_Plane.FanoutW -> AWS_VPC.Data_Layer.MSK_Cluster.T2

AWS_VPC.Data_Layer.MSK_Cluster.T2 -> AWS_VPC.EKS.Channel_Pools.PushW
AWS_VPC.Data_Layer.MSK_Cluster.T2 -> AWS_VPC.EKS.Channel_Pools.EmailW
AWS_VPC.Data_Layer.MSK_Cluster.T2 -> AWS_VPC.EKS.Channel_Pools.SmsW
AWS_VPC.Data_Layer.MSK_Cluster.T2 -> AWS_VPC.EKS.Channel_Pools.InappW

AWS_VPC.EKS.Channel_Pools.PushW -> AWS_VPC.Data_Layer.Redis_Cluster.RS1
AWS_VPC.EKS.Channel_Pools.EmailW -> AWS_VPC.Data_Layer.Redis_Cluster.RS1
AWS_VPC.EKS.Channel_Pools.SmsW -> AWS_VPC.Data_Layer.Redis_Cluster.RS1

AWS_VPC.EKS.Channel_Pools.PushW -> AWS_VPC.EKS.Egress.Proxy
AWS_VPC.EKS.Channel_Pools.EmailW -> AWS_VPC.EKS.Egress.Proxy
AWS_VPC.EKS.Channel_Pools.SmsW -> AWS_VPC.EKS.Egress.Proxy
AWS_VPC.EKS.Egress.Proxy -> AWS_VPC.Public_Subnet.NAT
AWS_VPC.Public_Subnet.NAT -> Internet.APNsFCM
AWS_VPC.Public_Subnet.NAT -> Internet.EmailP
AWS_VPC.Public_Subnet.NAT -> Internet.SmsP

AWS_VPC.EKS.Channel_Pools.PushW -> AWS_VPC.Data_Layer.MSK_Cluster.T3
AWS_VPC.EKS.Channel_Pools.EmailW -> AWS_VPC.Data_Layer.MSK_Cluster.T3
AWS_VPC.EKS.Channel_Pools.SmsW -> AWS_VPC.Data_Layer.MSK_Cluster.T3
AWS_VPC.Data_Layer.MSK_Cluster.T3 -> AWS_VPC.EKS.Control_Plane.StatusAgg
AWS_VPC.EKS.Control_Plane.StatusAgg -> AWS_VPC.Data_Layer.RDS_Cluster.PG_P
AWS_VPC.EKS.Control_Plane.StatusAgg -> AWS_VPC.Data_Layer.S3
AWS_VPC.Data_Layer.RDS_Cluster.PG_P -> AWS_VPC.Data_Layer.RDS_Cluster.PG_R1
AWS_VPC.Data_Layer.RDS_Cluster.PG_P -> AWS_VPC.Data_Layer.RDS_Cluster.PG_R2

AWS_VPC.EKS.Channel_Pools.PushW -> AWS_VPC.Observability.Prom {style.stroke-dash: 4}
AWS_VPC.EKS.Control_Plane.FanoutW -> AWS_VPC.Observability.Prom {style.stroke-dash: 4}
AWS_VPC.EKS.Control_Plane.StatusAgg -> AWS_VPC.Observability.ELK {style.stroke-dash: 4}
AWS_VPC.EKS.Control_Plane.NotifAPI -> AWS_VPC.Observability.Jaeger {style.stroke-dash: 4}
AWS_VPC.Observability.Prom -> AWS_VPC.Observability.CW {style.stroke-dash: 4}
```

### Scaling Strategy
- **HPA bằng KEDA theo Kafka Consumer Lag (không chỉ CPU):** Vì Channel Workers chủ yếu chờ I/O mạng `[C4]`, CPU thường dưới 30% ngay cả khi queue đang dồn ứ. Cấu hình KEDA scale:
  - `push-delivery-worker` (bulk): `min=8, max=40` khi lag > 50,000 messages `[C2]`
  - `email-delivery-worker`: `min=4, max=16` khi lag > 20,000 messages `[C3]`
  - `sms-delivery-worker`: `min=2, max=8` khi lag > 500 messages `[C3]`
  - `fanout-worker-service`: `min=8, max=32` (tối đa 64 tương ứng 64 partitions)
- **Database Scaling:** RDS Multi-AZ `db.r6g.4xlarge` + 2 Read Replicas (Replica 1 cho Inbox/Preferences, Replica 2 chuyên cho Fan-out keyset reads và Support query để không làm chậm API người dùng), dùng PgBouncer gom connection pool.
- **Cache Scaling:** ElastiCache Redis Cluster 6 shards × `cache.r6g.xlarge` (mỗi shard 26GB, 1 primary + 1 replica) phục vụ ~90GB dữ liệu `[C7]` kèm dư địa tăng trưởng.
- **Kafka Scaling:** Amazon MSK 6 brokers (`kafka.m5.xlarge`, RF=3) dư sức gánh 37.5MB/s peak `[C8]`.

### Caching Strategy
- **L1 (In-process Caffeine Cache trên mỗi pod):** Cache `template_id + version` (bất biến, TTL 1 giờ) và trạng thái `campaign_cancelled` (TTL 1 giây) để giảm triệu lần hỏi lặp lại.
- **L2 (Redis Cluster):**
  - `prefs:{userId}` (TTL 15 phút, invalidate ngay khi `PUT /notification-preferences`)
  - `devices:{userId}` (TTL 15 phút, invalidate khi đăng ký/xóa/deactivate token)
  - `dedup:{notificationId}:{attempt}` (TTL 24 giờ, eviction `noeviction` riêng ở shard dedup/rate limit để không làm mất khóa chống trùng)
  - `presence:{userId}` (TTL 60 giây, gia hạn bởi WebSocket heartbeat)
- **Pre-warming chống Self-DDoS:** Trước khi Fan-out Coordinator mở van chiến dịch > 100K subscribers, nó kích hoạt pre-warm metadata và thumbnail video lên Redis/CloudFront CDN.

### Load Balancing / Gateway / Service Mesh
- **ALB (L7):** Hỗ trợ cả HTTPS REST và WebSocket upgrade (sticky routing / connection draining mượt khi rollout In-app Gateway).
- **API Gateway:** Xác thực JWT, rate limit theo user/IP/đầu số OTP, gán `X-Trace-Id`.
- **Service Mesh (Istio/Linkerd):** Bật mTLS nội bộ giữa các microservice và áp dụng policy chỉ cho phép egress ra APNs/FCM/SES/Twilio thông qua **Egress Guard Proxy**.

### Resilience Patterns
- **Circuit Breaker (Resilience4j):** Mở mạch khi tỷ lệ lỗi `5xx`/timeout của một provider > 30% trong 60 giây; với SMS và Email tự động chuyển sang provider dự phòng (Twilio → Vonage, SES → SendGrid) và kích hoạt half-open thăm dò sau 30 giây.
- **Retry with Exponential Backoff + Full Jitter:** Bậc 10s → 1m → 5m → 30m, cộng nhiễu ngẫu nhiên chống thundering herd; tôn trọng header `Retry-After`.
- **Bulkhead:** Tách hoàn toàn thread/connection pool và Deployment theo `(channel, priority)` `[C3][C4]`. Java 21 Virtual Threads hoặc WebClient non-blocking giúp giữ >14,000 kết nối in-flight `[C4]` mà không cạn OS threads.
- **Timeout chặt theo từng phụ thuộc:** Connect timeout `1.5s`, read timeout `4s` cho APNs/FCM/SES/SMS; Redis timeout `100ms`; PostgreSQL query timeout `2s`.
- **Graceful Degradation:** Nếu Redis dedup/prefs lỗi, làn `CRITICAL` (OTP) fallback đọc DB và áp rate limit bảo thủ cục bộ; làn `BULK` tạm dừng tiêu thụ để bảo vệ provider và tự hồi phục khi Redis xanh trở lại.
- **Spend Cap / Budget Circuit Breaker:** Nếu chi phí SMS trong 1 giờ vượt ngưỡng dự kiến (ví dụ 3x baseline), tự động khóa làn SMS không phải OTP và báo động P1 ngay lập tức.

## 11. 🧪 Testing Strategy

- **Unit Testing (JUnit 5 + Mockito, target ≥ 80%):** Kiểm thử logic tính backoff + full jitter, tính Quiet Hours qua các múi giờ (kể cả qua nửa đêm 23:00 → 07:00 và Daylight Saving Time), Frequency Capping, và phân loại mã lỗi provider (`202` vs `410` vs `429`).
- **Integration Testing (Testcontainers):** Chạy PostgreSQL + Redis + Kafka thật trong container để kiểm tra:
  - Transactional Outbox commit nguyên tử và Debezium/Relay không làm mất sự kiện.
  - Sharded Fan-out kill giữa chừng ở batch thứ 3 rồi resume đúng từ `last_subscriber_id`.
  - Atomic ownership transfer của `device_token` khi User B đăng nhập trên thiết bị của User A.
- **API Contract Testing (Spring Cloud Contract):** Kiểm tra schema giữa Domain Services (Upload, Auth) và Notification API, đảm bảo thay đổi `template_version` luôn tương thích ngược.
- **Load Testing (k6 / Gatling):**
  - Kịch bản 1: Bơm 10 chiến dịch 1M subscribers song song (tổng 10M jobs), xác minh Push Peak đạt ~37,500/s `[C2]` trong khi làn `CRITICAL` (OTP) vẫn giữ p95 < 2s.
  - Kịch bản 2: Giả lập 5% provider responses chậm 3s `[C4]`, kiểm tra connection pool không bị cạn và Email chậm không kéo chậm Push.
- **Chaos Engineering (LitmusChaos / AWS FIS):**
  - Giết ngẫu nhiên 30% pod Fan-out Worker khi đang chạy chiến dịch 1M subscribers → xác minh hoàn tất 100% và tỷ lệ gửi trùng < 0.1%.
  - Chặn mạng tới SMS Provider A → xác minh Circuit Breaker failover sang Provider B trong < 60 giây.
  - Ngắt phản hồi HTTP sau khi mock provider đã nhận tin → kiểm tra `Idempotency-Key` hoạt động đúng ở lần retry.
- **Staging Safety & E2E Testing:** Kiểm thử tự động xác nhận Egress Guard Proxy ở môi trường Staging **từ chối 100%** mọi địa chỉ email/SĐT nằm ngoài allowlist nội bộ.

## 12. 🔒 Security

- **Authentication & Authorization:** User API dùng JWT (`RS256`); Internal API dùng mTLS + Service Token phân quyền chi tiết theo kênh và độ ưu tiên (chỉ Auth/Security Service mới có quyền gửi `SMS + CRITICAL`). Kill Switch và DLQ Replay yêu cầu Ops RBAC kèm audit log.
- **Chống SMS Pumping (Toll Fraud):**
  - Rate limit đa tầng theo số điện thoại (3/10m), IP (10/1h), device fingerprint và đầu số quốc gia.
  - Chặn tự động các dải số rủi ro cao hoặc quốc gia không có người dùng thật.
  - Theo dõi tỷ lệ chuyển đổi OTP (`otp_verified / otp_sent`): nếu tụt dưới 30% trong 10 phút → kích hoạt CAPTCHA/block tự động.
- **Email Deliverability & Anti-Spoofing:** Tách hoàn toàn IP và subdomain cho `transactional` (`auth.platform.example`) và `bulk` (`news.platform.example`); cấu hình bắt buộc **SPF, DKIM, DMARC (`p=reject`)**, thực hiện **IP Warm-up** cho IP mới, và gắn header `List-Unsubscribe` + `List-Unsubscribe-Post` (One-click Unsubscribe).
- **Bảo vệ dữ liệu & quyền riêng tư (PII / Compliance):**
  - Mã hóa at-rest bằng AWS KMS cho RDS, MSK, ElastiCache, S3; mã hóa in-transit bằng TLS 1.3.
  - Không ghi mã OTP, email hoặc SĐT dạng plaintext vào log ứng dụng, metric labels hay DLQ (bắt buộc redact trước khi đẩy DLQ).
  - Xử lý **account switching leak** bằng cách unlink `device_token` khi logout và atomic reassign khi login tài khoản mới.
  - Lưu audit log opt-in/opt-out và băm SHA-256 trong `suppression_list` để tuân thủ GDPR.
- **Input Validation & Template Security:** Escape HTML bắt buộc mọi biến từ người dùng (`video_title`, `creator_name`) khi render Email HTML để ngăn XSS và email header injection; giới hạn payload Push ≤ 4KB theo chuẩn APNs/FCM.
- **Secrets Management:** Lưu chứng chỉ APNs (`.p8`), khóa FCM, API key SES/Twilio trong **AWS Secrets Manager** có cơ chế xoay khóa (rotation) không downtime; tuyệt đối không hardcode trong image hay Helm values.
- **An toàn môi trường Staging:** Cài cứng allowlist ở tầng Egress Guard Proxy cho mọi môi trường non-production để triệt tiêu nguy cơ gửi nhầm thông báo test tới khách hàng thật.

## 13. 📊 Monitoring & Logging

### Key Metrics

| Nhóm | Metrics trọng yếu |
|---|---|
| **Latency** | `ingestion_latency_ms` (p50/p95/p99), `end_to_end_delivery_latency_ms` tách theo `(channel, priority)`, `provider_call_latency_ms` |
| **Traffic** | `events_ingested_total`, `fanout_jobs_generated_total`, `deliveries_attempted_total` theo `(channel, priority, provider)` |
| **Errors & Silent Failures** | `provider_error_rate` theo mã lỗi (`429`, `5xx`, `410`), `dlq_messages_total`, `hard_bounce_rate`, `spam_complaint_rate`, **`delivery_and_open_rate` tách theo domain email (`gmail`, `outlook`), nhà mạng SMS và OS (iOS/Android)** |
| **Saturation** | `outbox_oldest_unpublished_age_sec`, `kafka_consumer_lag` và `queue_oldest_message_age_sec` theo từng topic, `http_pool_active_connections`, `redis_memory_utilization` |
| **Business & Cost** | `sms_spend_usd_per_hour`, `otp_verification_conversion_rate`, `unregistered_token_rate`, `campaign_kill_switch_triggers` |

### Trace Latency Minh Họa (CRITICAL OTP Path)

Sơ đồ dưới đây minh họa cấu trúc độ trễ end-to-end cho một thông báo `CRITICAL` (OTP) từ lúc Auth Service ghi Outbox đến khi SMS Provider xác nhận `202 Accepted`.

```span-waterfall
title: End-to-end latency breakdown cho CRITICAL OTP (giá trị minh họa)
unit: ms
provenance:
  kind: illustrative
  description: Số liệu tổng hợp giả định để minh họa các chặng tốn thời gian trên đường CRITICAL, không phải trace đo thật từ production.
spans:
  - id: e2e
    name: Critical OTP End-to-End Delivery
    service: notification-platform
    start: 0
    duration: 420
    status: ok
  - id: outbox-tx
    parent: e2e
    name: Commit Auth + Outbox row
    service: auth-service
    start: 0
    duration: 18
    status: ok
  - id: cdc-relay
    parent: e2e
    name: Outbox CDC -> Kafka notif.events
    service: outbox-relay
    start: 18
    duration: 45
    status: ok
  - id: routing
    parent: e2e
    name: Campaign creation & route to sms.critical
    service: fanout-coordinator
    start: 63
    duration: 28
    status: ok
  - id: worker-checks
    parent: e2e
    name: TTL + Dedup + Redis Rate Limit + Template
    service: sms-delivery-worker
    start: 95
    duration: 22
    status: ok
    attributes: '{"priority":"CRITICAL","cache.hit":true}'
  - id: provider-call
    parent: e2e
    name: HTTPS POST SMS Provider (Twilio)
    service: egress-guard-proxy
    start: 117
    duration: 285
    status: ok
    attributes: '{"http.status_code":202,"provider":"twilio"}'
  - id: status-emit
    parent: e2e
    name: Emit ACCEPTED to notif.delivery.status
    service: sms-delivery-worker
    start: 402
    duration: 18
    status: ok
```

### Logging Strategy
- Structured JSON logs đẩy về OpenSearch (ELK), gắn đầy đủ correlation keys: `trace_id`, `event_id`, `campaign_id`, `notification_id`, `channel`, `priority`, `attempt`, `provider`.
- Tuyệt đối mask/redact `otp_code`, `email`, `phone_number`, `device_token` (chỉ log 6 ký tự cuối của token nếu cần debug).
- Retention: Hot logs 14 ngày trên OpenSearch, Warm/Archive 90 ngày trên S3.

### SLI / SLO / Error Budget (SRE)
- **SLI 1 (Durability):** Tỷ lệ sự kiện đã commit vào Outbox được fan-out và xử lý đúng chính sách (không mất ngầm). **SLO: 99.995%**.
- **SLI 2 (Critical Delivery Latency):** Tỷ lệ thông báo `CRITICAL` được gửi tới provider khỏe trong `< 5s`. **SLO: 99.95%** (Error Budget ≈ `21.6 phút/tháng`).
- **SLI 3 (Bulk Completion):** Tỷ lệ chiến dịch ≤ 1M subscribers hoàn tất giao hàng trong `< 15 phút`. **SLO: 99.5%**.
- **Chính sách Error Budget:** Khi Error Budget của làn `CRITICAL` bị tiêu thụ > 50% trong 7 ngày, đóng băng toàn bộ release tính năng mới trên Notification Platform để ưu tiên khắc phục độ tin cậy và tối ưu retry/failover.

### Alerting & Incident Response
- **P1 (Page ngay lập tức):**
  - `queue_oldest_message_age_sec{priority="CRITICAL"} > 10s` trong 2 phút.
  - `outbox_oldest_unpublished_age_sec > 30s` trong 3 phút.
  - `sms_spend_usd_per_hour > 3x baseline` hoặc `otp_conversion_rate < 30%` trong 10 phút (nghi vấn SMS Pumping).
  - Synthetic Canary (tài khoản kiểm thử thật bắn Push/Email mỗi 5 phút) thất bại 2 chu kỳ liên tiếp.
- **P2 (Cảnh báo giờ hành chính / Slack):**
  - `spam_complaint_rate > 0.1%` hoặc `hard_bounce_rate > 2%` (nguy cơ tụt IP Email reputation).
  - Open rate của riêng một domain email (ví dụ `@gmail.com`) giảm > 50% so với trung bình 7 ngày (dấu hiệu bị chặn ngầm).
  - `dlq_messages_total` tăng đột biến > 500 messages/5 phút.
- **Distributed Tracing:** OpenTelemetry SDK gắn trên mọi service + propagation qua Kafka headers, xuất sang Jaeger/X-Ray để truy vết trọn vẹn từ Upload API tới lệnh gọi provider.

## 14. 🔧 Maintenance

- **CI/CD Pipeline (GitHub Actions):** `Lint & Unit Test → Testcontainers Integration Test → Container Vulnerability Scan (Trivy) + SAST → Build & Push ECR → Deploy Staging (chạy Smoke Test + kiểm tra Egress Allowlist) → Canary Production`.
- **Database Migration (Flyway):** Áp dụng chiến lược Expand-and-Contract (luôn tương thích ngược để rolling update không lỗi); tạo trước các partition tương lai của `notification_deliveries` bằng cronjob/pg_partman trước 7 ngày và tự động archive + drop partition cũ sau 14 ngày.
- **Dependency & Certificate Management:** Renovate tự động cập nhật patch bảo mật; thiết lập alert sớm 30 ngày trước ngày hết hạn cho chứng chỉ APNs, DKIM keys và TLS certificates.
- **Feature Flags:** Điều khiển linh hoạt tốc độ pacing (`bulk_push_rate_per_sec`), bật/tắt Quiet Hours, chuyển tỷ lệ traffic giữa SMS/Email providers (ví dụ 80% SES / 20% SendGrid) và **Kill Switch** chiến dịch mà không cần redeploy.
- **Documentation & ADR:** Tự động xuất OpenAPI spec cho Internal/Public APIs; mọi thay đổi lớn về retry policy, schema template hoặc provider mới đều ghi lại bằng Architecture Decision Record (ADR).
- **Technical Debt:** Dành 15% năng lực mỗi sprint để rà soát template cũ không còn dùng, dọn token chết, tinh chỉnh ngưỡng KEDA và diễn tập failover provider hàng quý.

## 15. 🚀 Deployment Plans

- **Deployment Strategy:**
  - `notification-api` và `fanout-*`: **Canary deployment** (Argo Rollouts) 5% → 25% → 50% → 100%, tự động rollback nếu error rate > 1% hoặc p99 latency vượt ngưỡng.
  - `push/email/sms-delivery-worker`: **Rolling Update** với `maxUnavailable=0`, xử lý graceful shutdown (`SIGTERM` ngừng nhận message mới từ Kafka, hoàn tất các request in-flight trong 30 giây rồi mới thoát để giảm duplicate).
  - `inapp-gateway-service`: **Rolling Update chậm** (10% mỗi đợt) kèm jitter reconnect ở client để tránh triệu WebSocket đồng loạt kết nối lại.
- **Rollback Plan & Emergency Kill Switch:**

```terminal-session
title: Runbook khẩn cấp — kích hoạt Kill Switch chiến dịch và rollback Push Worker (minh họa)
context:
  kind: remote
  label: eks-prod-ap-southeast-1
steps:
  - id: kill-switch
    command: 'curl -sS -X POST https://internal-notif.example.invalid/api/v1/internal/campaigns/cmp_01J9Z4K8M2P7Q3R5S6T8V9W0XY/cancel -H "Authorization: Bearer $OPS_TOKEN"'
    warning: Thao tác này dừng ngay lập tức toàn bộ Fan-out và Push/Email đang chờ của chiến dịch đã chọn; các thông báo đã giao tới provider không thể thu hồi.
    expected: Trả về HTTP 200 kèm status CANCELLED; metric fanout_jobs_generated_total của chiến dịch giảm về 0 trong vòng 2 giây.
    outputs:
      - stream: stdout
        text: '{"campaign_id":"cmp_01J9Z4K8M2P7Q3R5S6T8V9W0XY","status":"CANCELLED","cancelled_at":"2026-04-19T12:10:05Z"}'
  - id: rollback-worker
    command: kubectl rollout undo deployment/push-delivery-worker -n notification-prod
    expected: Các pod Push Worker quay về revision ổn định trước đó mà không làm mất message trên Kafka.
    outputs:
      - stream: stdout
        text: deployment.apps/push-delivery-worker rolled back
  - id: verify-lag
    command: kubectl rollout status deployment/push-delivery-worker -n notification-prod --timeout=120s
    expected: Toàn bộ replica Ready và consumer lag làn CRITICAL ổn định dưới 5 giây.
    outputs:
      - stream: stdout
        text: deployment "push-delivery-worker" successfully rolled out
```

- **IaC (Terraform):** Chia module độc lập cho `vpc-egress`, `eks-notification-nodegroups`, `rds-postgres`, `elasticache-redis`, `msk-kafka`, `s3-archive` và `iam-irsa` (mỗi service chỉ có quyền IAM tối thiểu cho tài nguyên của mình).
- **Auto-scaling:** KEDA scale pod theo Kafka consumer lag + Karpenter tự động cấp phát node EKS trong < 60 giây khi vào khung giờ vàng; Cluster giữ sẵn warm headroom cho làn `CRITICAL`.
- **Multi-region:** Giai đoạn đầu chạy **Multi-AZ** trong `ap-southeast-1` (RDS Multi-AZ, MSK 3 AZs, Redis replicas khác AZ). Khi mở rộng toàn cầu, triển khai Active-Active cho In-app Gateway & Push Workers ở các region gần người dùng, còn dữ liệu Campaign/Preferences đồng bộ bất đồng bộ qua Route53 latency-based routing và RDS Global/cross-region read replicas.
- **Pre-prod Gate:** Bắt buộc vượt qua 4 cổng trước khi lên production: (1) Testcontainers integration test xanh, (2) Staging Egress Allowlist check xanh, (3) Canary load test xác nhận làn `CRITICAL` giữ SLO dưới tải `BULK`, (4) Security scan không có lỗ hổng Critical/High.

## 16. ⏱️ Effort Estimation

### Phase Breakdown & Timeline

| Phase | Duration | Deliverables |
|---|---|---|
| **Phase 1: Discovery & Foundation** | 2 tuần | Chốt contract sự kiện, thiết kế schema + Kafka topics, dựng Terraform hạ tầng (EKS, RDS, MSK, Redis, Egress Proxy), setup SPF/DKIM/DMARC & IP warm-up sớm |
| **Phase 2: MVP Core Pipeline** | 4 tuần | Outbox Relay, Notification API, Preferences & Device Token API, Push + Email Workers cơ bản, Idempotency + Retry + DLQ, Staging Allowlist |
| **Phase 3: Scale & Fan-out** | 3 tuần | Sharded Fan-out + Checkpoint, Priority Queue separation, Distributed Rate Limiter + Pacing, SMS Worker + SMS Pumping Guard + Multi-provider failover |
| **Phase 4: Smart Routing & UX** | 3 tuần | Quiet Hours + Frequency Capping + Delayed Scheduler, In-app WebSocket Gateway + Presence-aware routing, React Preferences & Inbox UI, Campaign Kill Switch |
| **Phase 5: Hardening & Go-Live** | 2 tuần | Load test 62.5K QPS, Chaos Engineering, Synthetic Canary monitoring, Support Replay UI, Runbooks, Canary rollout production |

**Tổng thời gian ước tính:** ~**14 tuần** (3.5 tháng).

### Team Composition
- **1 Tech Lead / Staff Backend Engineer:** Kiến trúc tổng thể, thiết kế fan-out/sharding, review security & failure modes.
- **3 Senior Backend Engineers (Java/Spring Boot):** Phát triển Notification API, Fan-out Workers, Channel Workers, Status Aggregator và tích hợp providers.
- **1 Frontend Engineer (React/TypeScript):** Xây dựng Preferences UI, In-app Inbox/WebSocket sync, Device Token lifecycle và Support Replay Dashboard.
- **1 DevOps / SRE Engineer:** Terraform IaC, KEDA/Karpenter, MSK/RDS/Redis tuning, Egress Guard Proxy, Observability & Chaos testing.
- **1 QA / Performance Engineer:** Testcontainers suite, k6 load testing, xác minh Egress Allowlist và failure-path testing.

### Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| **Self-DDoS khi bắn Push chiến dịch lớn** | Rất cao — sập Video API/CDN | Áp dụng Pacing theo tốc độ cố định `[C2]`, pre-warm cache trước fan-out và tránh Silent Push tự fetch ngược API |
| **Tấn công SMS Pumping gây nổ hóa đơn** | Rất cao — thiệt hại tài chính trực tiếp | Rate limit theo SĐT/IP/quốc gia, khóa quốc gia ngoài vùng phục vụ, budget circuit breaker & alert `otp_conversion_rate` |
| **Tụt uy tín IP Email (vào thẳng Spam)** | Cao — mất kênh OTP/hóa đơn | Tách hoàn toàn IP/subdomain Transactional và Bulk, IP warm-up từ tuần 1, tự động chặn Hard Bounce & Complaint |
| **Gửi nhầm thông báo Staging tới khách thật** | Cao — mất uy tín thương hiệu | Hard allowlist tại Egress Guard Proxy ở tầng hạ tầng cho mọi môi trường non-prod, kiểm thử tự động trong CI |
| **Rò rỉ thông báo khi đổi tài khoản trên cùng thiết bị** | Cao — sự cố bảo mật & quyền riêng tư | Unlink token khi logout + atomic reassign `device_token → user_id` mới khi login + xóa cache ngay |

### Dependencies & Blockers
- **Security & Legal Team:** Phê duyệt chính sách lưu trữ PII, cơ chế băm `suppression_list`, và tuân thủ quy định đăng ký Brandname/Template SMS theo từng quốc gia.
- **Email/SMS Provider Onboarding:** Đăng ký Dedicated IP và chạy quy trình **IP Warm-up** (cần 3–4 tuần nên phải khởi động ngay từ Phase 1).
- **Mobile Teams (iOS/Android):** Đồng bộ tích hợp đăng ký/hủy `device_token`, hỗ trợ `collapse_key`, và truyền sự kiện mở thông báo (opened tracking).

## 17. 💰 Cost Estimation & Optimization

Giá tham chiếu theo **AWS On-Demand tại region `ap-southeast-1` (Singapore)** (ước lượng làm tròn để lập kế hoạch ngân sách; tách riêng chi phí hạ tầng AWS và chi phí biến đổi của nhà cung cấp SMS/Email ngoài).

### 17.1 Chi phí hạ tầng hàng tháng theo từng resource (Base Scale — 50M DAU)

| Category | Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú / Truy nguồn |
|---|---|---|---|---|---|---|
| **Compute** | EKS Control Plane | Managed cluster | 1 | $73 | $73 | Cụm Notification riêng biệt |
| **Compute** | EKS Worker Nodes (API, Fan-out, Workers) | `c6i.2xlarge` (8 vCPU, 16GB RAM) | 20 (avg) | $295 | $5,900 | Phục vụ ~6.25K avg / 62.5K peak `[C1][C2][C3]`, scale lên ~45 nodes lúc peak |
| **Database** | RDS PostgreSQL Primary + Standby (Multi-AZ) | `db.r6g.4xlarge` Multi-AZ | 1 cặp | $3,580 | $3,580 | Chịu batch-write + partition 14 ngày `[C5]` |
| **Database** | RDS PostgreSQL Read Replicas | `db.r6g.2xlarge` | 2 | $895 | $1,790 | 1 replica Inbox/Prefs + 1 replica Fan-out/Support |
| **Database** | RDS Storage (gp3) + Backup | 4TB gp3 (Primary + 2 Replicas) | 12TB tổng | $138/TB | $1,656 | Dư địa cho 2.8TB hot `[C5]` + WAL |
| **Cache** | ElastiCache Redis Cluster | `cache.r6g.xlarge` (26GB, 6 shards × 2 nodes) | 12 nodes | $270 | $3,240 | Phục vụ ~90GB primary `[C7]` + HA replicas |
| **Message Queue** | Amazon MSK (Kafka) | `kafka.m5.xlarge` (3 AZs) + 6TB EBS | 6 brokers | $320 | $1,920 | Dư tải 37.5MB/s peak × RF=3 `[C8]` |
| **Network** | ALB + NAT Gateways + Data Transfer Egress | 3 NAT GWs + ~15TB egress/tháng | 1 cụm | — | $2,250 | Gửi HTTPS tới APNs/FCM/SES/Twilio `[C8]` |
| **Storage** | S3 Standard + Intelligent-Tiering | ~10TB (Parquet archive 1 năm + templates) | 10TB | $25/TB | $250 | Lưu trữ lạnh 9.1TB/năm `[C6]` |
| **Observability** | OpenSearch + Prometheus/Grafana + CloudWatch | 3 data nodes `r6g.large` + metrics/traces | 1 cụm | — | $1,450 | Structured logs 14 ngày + Golden Signals |
| **Misc** | AWS WAF + Secrets Manager + KMS | Rule groups + secret rotation | 1 bộ | — | $220 | Chống OTP flood & mã hóa PII |
| **Tổng hạ tầng AWS (Base)** | | | | | **$22,329** | Chưa gồm phí biến đổi gửi SMS/Email |

> 📌 **Lưu ý chi phí biến đổi (External Providers):**
> - **Mobile Push (APNs/FCM):** `$0` (miễn phí từ Apple/Google).
> - **Email (AWS SES, 60M email/ngày = 1.8B/tháng):** ~$0.10 / 1,000 email ≈ **$180,000/tháng** nếu gửi toàn bộ 1.8B email — đây là lý do **Presence-aware routing**, **User Preferences** và **Digest** (gom nhiều video thành 1 email ngày) mang lại giá trị tiết kiệm tài chính khổng lồ.
> - **SMS (15M SMS/ngày — giả sử giảm xuống chỉ còn 1M OTP/ngày nhờ chuyển cảnh báo sang Push/In-app):** ở mức ~$0.01–$0.04/SMS tùy quốc gia → **$300,000–$1,200,000/tháng**. Kiểm soát chặt ai được gửi SMS và chống SMS Pumping quan trọng hơn cả tối ưu server!

### 17.2 Tổng hợp chi phí hạ tầng AWS theo giai đoạn

| Giai đoạn | Monthly Cost (Infra AWS) | Annual Cost | Assumptions |
|---|---|---|---|
| **MVP** (1M–5M DAU) | **~$3,200** | ~$38,400 | 4 nodes `c6i.xlarge`, RDS `db.r6g.large` Multi-AZ, Redis 2 shards, SQS/MSK nhỏ (3 `kafka.t3.small`) |
| **Growth / Base** (50M DAU, avg) | **~$22,329** | ~$267,948 | Cấu hình chi tiết ở §17.1, 20 nodes trung bình, 6 shards Redis, 6 brokers MSK |
| **Peak / Scale** (100M+ DAU, cao điểm) | **~$44,500** | ~$534,000 | Mở rộng 45 nodes EKS giờ vàng, nâng RDS lên `r6g.8xlarge` hoặc shard Citus, 12 shards Redis, 12 brokers MSK |

### 17.3 Cost Breakdown hạ tầng AWS theo Category (Base Scale)

| Category | Chi phí (USD/tháng) | % tổng cost |
|---|---|---|
| **Database (RDS + Storage)** | $7,026 | **31.5%** |
| **Compute (EKS)** | $5,973 | **26.7%** |
| **Cache (ElastiCache Redis)** | $3,240 | **14.5%** |
| **Network (ALB + NAT + Egress)** | $2,250 | **10.1%** |
| **Message Queue (MSK)** | $1,920 | **8.6%** |
| **Observability (ELK + Prom + CW)** | $1,450 | **6.5%** |
| **Storage (S3) & Security Misc** | $470 | **2.1%** |

### 17.4 Cost Optimization Strategies

1. **Chuyển đổi kênh thông minh (SMS → Push/In-app + Email Digest):**
   - **Mô tả:** Dùng Presence-aware routing để chỉ hiện In-app khi user đang mở app; ưu tiên Push Authenticator thay SMS OTP cho user đã cài app; gom thông báo video qua Email thành bản tin tổng hợp cuối ngày (Daily Digest).
   - **Tiết kiệm ước tính:** Giảm **50–80% hóa đơn SMS/Email provider** (tiết kiệm lớn nhất toàn hệ thống, gấp nhiều lần chi phí server).
   - **Trade-off:** Cần thêm logic quản lý trạng thái Presence và lịch gom Digest.
2. **AWS Savings Plans & Reserved Instances (1–3 năm) cho nền ổn định:**
   - **Mô tả:** Mua Compute Savings Plans cho nhóm pod chạy thường trực (`min` replicas, API, Status Aggregator) và Reserved Instances cho RDS, ElastiCache, MSK.
   - **Tiết kiệm ước tính:** Giảm **35–50%** trên phần tài nguyên nền (~$6,000–$8,500/tháng ở Base Scale).
   - **Trade-off:** Cam kết sử dụng cố định 1–3 năm, kém linh hoạt nếu thay đổi kiến trúc đột ngột.
3. **Spot Instances cho Bulk Workers & Fan-out Workers:**
   - **Mô tả:** Chạy làn `BULK` (Push Bulk, Email Bulk, Sharded Fan-out) trên EKS Spot Node Group (trộn nhiều dòng máy `c6i`, `c6a`, `c7i`); giữ làn `CRITICAL` trên On-Demand/Reserved.
   - **Tiết kiệm ước tính:** Giảm **60–70%** chi phí compute cho các pod mở rộng lúc cao điểm (~$2,000–$2,500/tháng).
   - **Trade-off:** Pod có thể nhận thông báo thu hồi trước 2 phút — hoàn toàn an toàn vì hệ thống đã có checkpoint fan-out và graceful shutdown Kafka.
4. **Rút ngắn TTL Dedup & nén dữ liệu lưu trữ:**
   - **Mô tả:** Giảm TTL khóa dedup trên Redis từ 24h xuống đúng cửa sổ retry thực tế (ví dụ 2h cho Bulk Push), chuyển log delivery > 14 ngày sang S3 Parquet nén ZSTD + Glacier sau 180 ngày.
   - **Tiết kiệm ước tính:** Giảm **~30% dung lượng Redis Cluster** (`~$950/tháng`) và **~70% chi phí lưu trữ dài hạn**.
   - **Trade-off:** Replay DLQ sau thời gian TTL dedup cần đối chiếu lại trạng thái trong PostgreSQL trước khi gửi.
5. **Tận dụng VPC Endpoints cho S3, Secrets Manager, CloudWatch và SES:**
   - **Mô tả:** Định tuyến lưu lượng tới các dịch vụ AWS qua Gateway/Interface VPC Endpoints thay vì đi qua NAT Gateway (tránh phí `$0.045/GB` data processing của NAT).
   - **Tiết kiệm ước tính:** Giảm **20–35% chi phí Network/NAT** (`~$400–$700/tháng`).
   - **Trade-off:** Không có đánh đổi hiệu năng, đồng thời tăng cường bảo mật mạng nội bộ.
