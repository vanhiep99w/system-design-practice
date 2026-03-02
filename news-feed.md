# News Feed (Facebook/Twitter) - System Design

## 1. 📋 Đề Bài (Problem Statement)
- Thiết kế hệ thống **News Feed** cho mạng xã hội tương tự Facebook / Twitter, cho phép người dùng tạo bài đăng (post) và xem feed cá nhân hóa từ những người họ follow.
- Hệ thống phải xử lý lượng đọc rất lớn (feed fetch), tạo feed nhanh chóng với ranking phù hợp, và hỗ trợ cập nhật real-time khi có bài đăng mới.
- **Scope chính** (in scope):
  - Tạo post (text, ảnh, video link)
  - Follow / Unfollow users
  - Generate personalized news feed (ranked, infinite scroll)
  - Like, Comment, Share posts
  - Real-time feed updates (push notification khi có post mới)
- **Scope ngoài bài** (out of scope): Ads system, Stories/Reels, Marketplace, Groups/Pages management, E2E encryption, video streaming/transcoding, search/discovery engine.
- **Mục tiêu business**: cung cấp trải nghiệm feed hấp dẫn, giữ chân người dùng (engagement), phục vụ hàng trăm triệu DAU với latency thấp và feed quality cao.

## 2. 🔍 Requirement Gathering & Analysis

### 2.1 Functional Requirements
| Priority | Requirement | Mô tả |
|---|---|---|
| MUST-HAVE | Create post | User tạo bài đăng với text, kèm media (ảnh/video link) tùy chọn |
| MUST-HAVE | News feed generation | Hiển thị feed cá nhân hóa từ posts của users đang follow, sắp xếp theo ranking |
| MUST-HAVE | Follow / Unfollow | User follow/unfollow user khác để nhận/ngừng nhận posts trong feed |
| MUST-HAVE | Like post | User like/unlike một post |
| MUST-HAVE | Comment on post | User comment trên post, hỗ trợ nested replies |
| MUST-HAVE | Infinite scroll pagination | Feed load thêm posts khi user scroll xuống (cursor-based) |
| MUST-HAVE | High availability feed | Feed vẫn serve được khi một phần service lỗi |
| NICE-TO-HAVE | Share / Repost | User share post lên feed của mình với comment tùy chọn |
| NICE-TO-HAVE | Real-time feed update | Push notification / badge khi có post mới từ người đang follow |
| NICE-TO-HAVE | Post visibility | User chọn public / followers-only / private cho mỗi post |
| NICE-TO-HAVE | Trending posts | Hiển thị posts đang trending dựa trên engagement |

### 2.2 Non-Functional Requirements
- **Performance**: Feed fetch p95 < 200ms (cache hit), create post p95 < 500ms (bao gồm async fan-out). Like/comment p95 < 100ms.
- **Scalability**: Hỗ trợ 100M DAU, peak ~46K feed read QPS, peak ~2.9K write QPS, peak ~573K fan-out writes/s.
- **Availability**: SLA 99.99% cho feed read path, 99.9% cho write path (create post, engagement).
- **Consistency**: Feed chấp nhận eventual consistency (post mới xuất hiện trong feed followers trong < 5s cho normal users). Engagement counters (like count, comment count) eventual consistency < 3s. Follow/unfollow effect on feed: < 30s.
- **Security**: JWT/OAuth2 cho authentication, rate limiting chống spam post/comment, content moderation cơ bản (text filter).
- **Cost**: Ước lượng ~$15,000-25,000/tháng cho MVP, scale lên full traffic ~$80,000-150,000/tháng (do Redis cluster lớn cho feed cache).
- **Observability**: Golden Signals (latency, error, traffic, saturation), distributed tracing cho feed generation path, alert khi feed latency p99 > 500ms hoặc fan-out lag > 10s.

### 2.3 Capacity Estimation (Back-of-the-envelope)

#### Bước 0: Quy ước đơn vị
- `1 day = 86,400 seconds`
- `1M = 1,000,000`, `1B = 1,000,000,000` (Billion, không phải Byte)
- Dùng đơn vị thập phân: `1KB = 1,000B`, `1GB = 1,000,000,000B`

#### Bước 1: Inputs giả định
| Input | Giá trị | Tại sao chọn |
|---|---|---|
| DAU | 100M users/day | Scale mạng xã hội lớn (tương đương Twitter/X ~250M, chọn 100M moderate) |
| Posts per user per day | 0.5 | Không phải ai cũng đăng mỗi ngày; Facebook avg ~0.3-0.5 posts/user/day |
| Feed views per user per day | 8 lần | User mở app xem feed nhiều lần trong ngày (sáng, trưa, tối, rảnh) |
| Posts per feed page | 20 posts | Standard infinite scroll batch size |
| Avg followers per user | 200 | Trung bình social network (Facebook ~338, Twitter ~707; chọn 200 moderate) |
| Celebrity threshold | ≥ 10,000 followers | Users có ≥10K followers được xử lý riêng (fan-out on read) |
| Celebrity ratio | ~0.1% users | ~100K celebrity users trên 100M DAU |
| Post text + metadata | 1.5KB | Text body 500B + metadata 1KB (user info, timestamps, counters, tags) |
| Media ratio | 30% posts có media | Gần 1/3 posts kèm ảnh |
| Avg media size | 500KB | Ảnh JPEG nén, multiple sizes (thumbnail + full) |
| Peak factor | 5x | Giờ cao điểm tối 19h-23h, weekend |

#### Bước 2: Tính write traffic (create post)
- Công thức: `total_posts_per_day = DAU × posts_per_user`
- Thay số: `100,000,000 × 0.5 = 50,000,000 = 50M posts/day`
- Công thức: `write_qps_avg = total_posts_per_day / 86,400`
- Thay số: `50,000,000 / 86,400 = 578.7`
- Kết quả: **write QPS trung bình ≈ 579**
- Peak factor `×5`: `579 × 5 = 2,894`
- Kết quả: **peak write QPS ≈ 2,894**

#### Bước 3: Tính read traffic (feed fetch)
- Công thức: `total_feed_requests_per_day = DAU × feed_views_per_day`
- Thay số: `100,000,000 × 8 = 800,000,000 = 800M requests/day`
- Công thức: `read_qps_avg = total_feed_requests_per_day / 86,400`
- Thay số: `800,000,000 / 86,400 = 9,259.3`
- Kết quả: **read QPS trung bình ≈ 9,259**
- Peak factor `×5`: `9,259 × 5 = 46,296`
- Kết quả: **peak read QPS ≈ 46,296**

> 📌 Read:Write ratio = 9,259 / 579 ≈ **16:1** — hệ thống read-heavy, ưu tiên tối ưu read path.

#### Bước 4: Tính fan-out write traffic (push to feed cache)
Khi user tạo post, cần push post_id vào feed cache của tất cả followers (chỉ cho normal users, không fan-out cho celebrity).

- Normal user posts: `579 × 99% = 573 posts/s`
- Fan-out writes per second: `573 × 200 avg followers = 114,642 writes/s`
- Peak factor `×5`: `114,642 × 5 = 573,210`
- Kết quả: **fan-out write QPS trung bình ≈ 114,642, peak ≈ 573,210**

> 📌 Celebrity posts (0.1% × 579 ≈ 0.6 posts/s) KHÔNG fan-out on write. Thay vào đó, khi follower fetch feed, Feed Service sẽ pull celebrity posts real-time và merge.

#### Bước 5: Tính storage cho posts
- Record size: `post_text_metadata = 1.5KB`
- Daily storage: `50,000,000 × 1.5KB = 75,000,000KB = 75GB/day`
- Yearly storage: `75GB × 365 = 27,375GB ≈ 27.4TB/year`
- 3-year storage: `27.4TB × 3 = 82.2TB`
- Cộng indexes + replication (×3): `82.2TB × 3 ≈ 246.6TB`

> 📌 Thực tế partition theo tháng + archive data cũ (> 1 năm) sang cold storage giúp giảm active storage.

#### Bước 6: Tính media storage (S3)
- Media posts per day: `50M × 30% = 15M media posts/day`
- Daily media storage: `15,000,000 × 500KB = 7,500,000,000KB = 7.5TB/day`
- Yearly media storage: `7.5TB × 365 = 2,737.5TB ≈ 2.74PB/year`

> 📌 Media lưu trên S3 với lifecycle policy: Standard (0-90 ngày) → Intelligent-Tiering (90+ ngày) → Glacier (1+ năm cho media ít truy cập).

#### Bước 7: Tính feed cache memory (Redis)
- Mỗi user cache 500 post IDs gần nhất trong feed
- Per entry: `post_id (8B) + score/timestamp (8B) = 16B`
- Per user: `500 × 16B = 8,000B = 8KB`
- Total feed cache: `100,000,000 × 8KB = 800,000,000KB = 800GB`
- Cộng Redis overhead (~25%): `800GB × 1.25 = 1,000GB ≈ 1TB`

> 📌 1TB Redis cluster là lớn nhưng khả thi. Thực tế chỉ cache feed cho active users (DAU), inactive users rebuild on demand.

#### Bước 8: Tính bandwidth cho feed reads
- Avg feed response: `20 posts × 2KB per post (post data + denormalized user info) = 40KB`
- Avg bandwidth: `9,259 req/s × 40KB = 370,360KB/s ≈ 370MB/s`
- Peak bandwidth: `370MB/s × 5 = 1,852MB/s ≈ 1.85GB/s`

> 📌 Media (ảnh) serve từ CDN (CloudFront), KHÔNG tính vào bandwidth API server. Chỉ tính text + metadata.

#### Bước 9: So sánh kịch bản

| Metric | Base (100M DAU) | Conservative (50M DAU) | Ghi chú |
|---|---|---|---|
| Write QPS (avg/peak) | 579 / 2,894 | 289 / 1,447 | Base = target scale |
| Read QPS (avg/peak) | 9,259 / 46,296 | 4,630 / 23,148 | |
| Fan-out writes/s (avg/peak) | 114,642 / 573,210 | 57,321 / 286,605 | |
| Storage/year | 27.4TB | 13.7TB | |
| Media/year | 2.74PB | 1.37PB | S3, lifecycle tiering |
| Feed cache | ~1TB | ~500GB | Redis cluster |
| Bandwidth (avg/peak) | 370MB/s / 1.85GB/s | 185MB/s / 925MB/s | Exclude media CDN |

> 📌 Kịch bản Conservative (50M DAU) cho thấy hệ thống vẫn cần Redis cluster đáng kể (~500GB) và fan-out writes cao (~57K/s). Đây là bài toán thực sự cần giải quyết fan-out problem.

#### Bước 10: 📊 Bảng tổng hợp Capacity Estimation

| ID | Metric | Avg | Peak | Quyết định được drive bởi số liệu này |
|---|---|---|---|---|
| C1 | Write QPS (post creation) | ~579 | **~2,894** | §3.2 Fan-out strategy (2.9K posts/s cần async processing) · §10 HPA Post Service min=3, max=10 |
| C2 | Read QPS (feed fetch) | ~9,259 | **~46,296** | §3.2 Hybrid fan-out (pre-compute feeds để serve 46K QPS) · §10 HPA Feed Service min=8, max=40 · §10 Caching multi-layer |
| C3 | Fan-out write QPS | ~114,642 | **~573,210** | §3.2 Chọn Hybrid (573K writes/s nếu fan-out tất cả celebrity → chọn pull cho celebrity) · §10 Kafka partitions ≥ 32 · §10 HPA Fan-out Service min=10, max=50 |
| C4 | Storage/year (posts) | **~27.4TB** | — | §8 Partition by month (~2.3TB/partition) · §8 Archive policy > 1 year |
| C5 | Media storage/year | **~2.74PB** | — | §10 S3 + CloudFront · §10 Lifecycle policy (Standard → IA → Glacier) |
| C6 | Feed cache memory | **~1TB** | — | §10 Redis Cluster 20 nodes × r6g.2xlarge (52GB each) · §8 Cache 500 post IDs per user |
| C7 | Feed read bandwidth | ~370MB/s | **~1.85GB/s** | §10 ALB + CloudFront CDN offload · §5 Response compression (gzip) |

## 3. ⚖️ Trade-offs

### 3.1 Bảng tổng quan quyết định
| Decision | Option A | Option B | Option C | Chọn | Lý do chính |
|---|---|---|---|---|---|
| Fan-out strategy | Fan-out on Write | Fan-out on Read | **Hybrid** | **Hybrid** | Balance write amplification vs read latency; giải quyết celebrity problem |
| Feed storage | PostgreSQL only | Redis only | **Redis cache + PostgreSQL source** | **Redis + PostgreSQL** | Redis cho low-latency read, PostgreSQL cho durability |
| Feed ranking | Chronological | **Score-based** | ML-based | **Score-based** | Đủ phức tạp để cải thiện engagement, không quá complex cho MVP |
| Real-time update | Polling | **WebSocket** | SSE | **WebSocket** | Bidirectional, low-latency push cho feed updates |
| Post ID generation | UUID v4 | **Snowflake ID** | Auto-increment | **Snowflake ID** | Sortable by time, distributed generation, no coordination |
| Media storage | Local disk | **S3 + CDN** | — | **S3 + CDN** | Scalable, durable, global edge delivery |

### 3.2 Fan-out on Write vs Fan-out on Read → Hybrid

**Bảng so sánh tiêu chí:**

| Tiêu chí | Fan-out on Write (Push) | Fan-out on Read (Pull) | Hybrid |
|---|---|---|---|
| Feed read latency | ⚡ Rất thấp (pre-computed) | 🐢 Cao (phải query + merge real-time) | ⚡ Thấp (pre-computed + merge ít celebrity posts) |
| Write amplification | 🔴 Cao (1 post → N writes) | ✅ Không có | 🟡 Moderate (chỉ fan-out cho normal users) |
| Celebrity problem | 🔴 1 post → 10M+ writes | ✅ Không ảnh hưởng | ✅ Celebrity pull on read |
| Storage (feed cache) | 🔴 Lớn (cache cho mọi user) | ✅ Nhỏ | 🟡 Moderate |
| Freshness | ⚡ Near real-time | 🐢 Depend on poll interval | ⚡ Near real-time |
| Implementation complexity | ✅ Đơn giản | ✅ Đơn giản | 🟡 Moderate (cần merge logic) |

**Hoạt động thế nào?**

**Fan-out on Write (Push Model):**
1. User A tạo post
2. Post Service lưu post vào DB
3. Fan-out Service lấy danh sách tất cả followers của A
4. Với mỗi follower, push `post_id` vào sorted set `feed:{follower_id}` trong Redis
5. Khi follower fetch feed → đọc trực tiếp từ Redis → rất nhanh

**Fan-out on Read (Pull Model):**
1. User A tạo post → chỉ lưu vào DB
2. Khi follower B fetch feed:
   - Lấy danh sách following của B
   - Query posts gần nhất từ tất cả users B đang follow
   - Merge + sort + rank → trả về
3. Mỗi feed request phải query nhiều bảng → latency cao

**Hybrid (Chọn):**
1. User A tạo post → Post Service lưu vào DB
2. Fan-out Service kiểm tra: A có ≥ 10K followers?
   - **Không (normal user)**: Fan-out on write — push `post_id` đến tất cả followers' Redis feeds
   - **Có (celebrity)**: Không fan-out — chỉ lưu vào `celebrity_posts:{user_id}` cache
3. Khi follower B fetch feed:
   - Lấy pre-computed feed từ Redis `feed:{B}` (đã có posts từ normal users)
   - Lấy danh sách celebrity mà B follow
   - Pull recent posts từ mỗi celebrity's cache
   - Merge + rank → trả về

**Ví dụ với số thật:**
- User A (normal, 500 followers) đăng 1 post:
  - Fan-out: 500 Redis ZADD operations → ~1ms total (pipelined)
  - Follower fetch feed: 1 ZRANGE call → p95 < 5ms
- Celebrity X (5M followers) đăng 1 post:
  - Nếu fan-out on write: 5,000,000 ZADD operations → ~5 seconds, blocking Kafka consumers
  - Hybrid: Chỉ lưu vào `celebrity_posts:X` → 1 write → <1ms
  - Follower fetch feed: merge 10-20 celebrity posts + pre-computed feed → p95 < 50ms

**Pseudo-code so sánh:**

```java
// Fan-out on Write — FanoutService
public void fanoutPost(Post post) {
    List<Long> followerIds = socialGraphService.getFollowers(post.getUserId());
    // 1 post → N Redis writes — celebrity có thể tạo millions writes
    for (Long followerId : followerIds) {
        redisTemplate.opsForZSet().add(
            "feed:" + followerId, 
            post.getId().toString(), 
            post.getCreatedAt().toEpochMilli()
        );
    }
}

// Hybrid — FanoutService (chọn)
public void fanoutPost(Post post) {
    if (isCelebrity(post.getUserId())) {
        // Celebrity: chỉ cache post, KHÔNG fan-out
        redisTemplate.opsForZSet().add(
            "celebrity_posts:" + post.getUserId(),
            post.getId().toString(),
            post.getCreatedAt().toEpochMilli()
        );
        return;
    }
    // Normal user: fan-out on write
    List<Long> followerIds = socialGraphService.getFollowers(post.getUserId());
    try (var pipeline = redisTemplate.executePipelined((RedisCallback<Object>) conn -> {
        for (Long followerId : followerIds) {
            conn.zSetCommands().zAdd(
                ("feed:" + followerId).getBytes(),
                post.getCreatedAt().toEpochMilli(),
                post.getId().toString().getBytes()
            );
        }
        return null;
    }));
}
```

**Kết luận:** Với 100M DAU và celebrity users có hàng triệu followers, fan-out on write thuần túy tạo write amplification quá lớn (573K writes/s peak `[C3]`). Fan-out on read thuần túy gây latency cao cho mỗi feed request. **Hybrid approach** giải quyết cả hai: pre-compute cho 99% users (low read latency) và pull cho 1% celebrities (tránh write amplification). Trade-off: merge logic phức tạp hơn ở read path, nhưng chỉ merge 10-20 celebrity sources nên latency overhead < 50ms.

### 3.3 Feed Ranking: Chronological vs Score-based

| Tiêu chí | Chronological | Score-based | ML-based |
|---|---|---|---|
| Implementation | ✅ Đơn giản (sort by time) | 🟡 Moderate (formula) | 🔴 Complex (model training) |
| User engagement | 🟡 Trung bình | ✅ Tốt | ⚡ Tốt nhất |
| Transparency | ✅ User hiểu rõ | 🟡 Hơi opaque | 🔴 Black box |
| Freshness bias | ✅ Luôn mới nhất | 🟡 Có thể miss trending | 🟡 Depend on features |
| Infra cost | ✅ Thấp | 🟡 Moderate | 🔴 Cao (GPU, training) |

**Score-based ranking (chọn):**

```
score = w1 × recency_score + w2 × engagement_score + w3 × affinity_score + w4 × type_bonus
```

Trong đó:
- `recency_score = max(0, 1 - (now - created_at) / 24h)` — post < 24h được ưu tiên
- `engagement_score = log2(1 + likes + 2×comments + 3×shares)` — log scale tránh viral post dominate
- `affinity_score` — tính từ interaction history giữa viewer và author (like, comment, share gần đây)
- `type_bonus` — bonus cho media posts (ảnh/video thường engagement cao hơn)
- Weights mặc định: `w1=0.4, w2=0.3, w3=0.2, w4=0.1`

**Kết luận:** Score-based ranking cung cấp feed quality tốt hơn chronological đáng kể, mà không cần infrastructure phức tạp như ML-based. Có thể evolve sang ML-based sau khi có đủ engagement data. Mitigation: cung cấp toggle cho user chuyển sang "Latest" (chronological) nếu muốn.

### 3.4 Post ID Generation: Snowflake ID

| Tiêu chí | UUID v4 | Snowflake ID | Auto-increment |
|---|---|---|---|
| Sortable by time | ❌ Không | ✅ Có | ✅ Có |
| Distributed generation | ✅ Không cần coordination | ✅ Không cần coordination | ❌ Cần central counter |
| Size | 128 bits (16B) | 64 bits (8B) | 64 bits (8B) |
| Index performance | 🔴 Random → B-tree fragmentation | ✅ Sequential → tốt | ✅ Sequential |
| Collision risk | Cực thấp | Không (unique per worker) | Không |

**Kết luận:** Chọn **Snowflake ID** — sortable by time (quan trọng cho feed ordering), compact (8B), distributed generation không cần coordination. Với peak 2,894 posts/s `[C1]`, Snowflake ID đủ capacity (4096 IDs/ms/worker).

## 4. 🧩 Defining Entities / Components

```mermaid
flowchart TB
    subgraph Edge["Edge Layer"]
        Client["📱 Client\n(React SPA / Mobile App)"]
        CDN["🌐 CloudFront CDN\n(Media delivery)"]
        WAF["🛡️ AWS WAF\n(DDoS protection)"]
    end

    subgraph Gateway["API Gateway Layer"]
        ALB["⚖️ ALB\n(Load Balancer)"]
        APIGW["🚪 API Gateway\n(Auth, Rate Limit, Routing)"]
    end

    subgraph Application["Application Layer (EKS)"]
        PostSvc["📝 Post Service\n(CRUD posts)"]
        FeedSvc["📰 Feed Service\n(Generate & serve feed)"]
        FanoutSvc["📡 Fan-out Service\n(Distribute posts to feeds)"]
        SocialSvc["👥 Social Graph Service\n(Follow/Unfollow)"]
        EngageSvc["❤️ Engagement Service\n(Like/Comment/Share)"]
        RankSvc["📊 Ranking Service\n(Score & rank feed)"]
        NotifSvc["🔔 Notification Service\n(Push notifications)"]
        MediaSvc["🖼️ Media Service\n(Upload coordination)"]
    end

    subgraph Data["Data Layer"]
        PG_Primary["🐘 PostgreSQL Primary\n(Posts, Users, Follows)"]
        PG_Replica["🐘 PostgreSQL Replica\n(Read replicas)"]
        Redis["⚡ Redis Cluster\n(Feed cache, Post cache)"]
        S3["📦 S3\n(Media storage)"]
    end

    subgraph Async["Async Layer"]
        Kafka["📨 Apache Kafka\n(Event streaming)"]
    end

    subgraph Observability["Observability"]
        Prometheus["📈 Prometheus + Grafana"]
        ELK["📋 ELK Stack"]
        Jaeger["🔍 Jaeger (Tracing)"]
    end

    Client --> CDN
    Client --> WAF --> ALB --> APIGW
    APIGW --> PostSvc
    APIGW --> FeedSvc
    APIGW --> SocialSvc
    APIGW --> EngageSvc
    APIGW --> MediaSvc

    PostSvc --> PG_Primary
    PostSvc --> Kafka
    FeedSvc --> Redis
    FeedSvc --> PG_Replica
    FeedSvc --> RankSvc
    FanoutSvc --> Redis
    FanoutSvc --> SocialSvc
    SocialSvc --> PG_Primary
    SocialSvc --> Redis
    EngageSvc --> PG_Primary
    EngageSvc --> Redis
    EngageSvc --> Kafka
    MediaSvc --> S3
    NotifSvc --> Client

    Kafka --> FanoutSvc
    Kafka --> NotifSvc
    Kafka --> EngageSvc

    PG_Primary --> PG_Replica

    PostSvc -.-> Prometheus
    FeedSvc -.-> Prometheus
    FanoutSvc -.-> Prometheus
    PostSvc -.-> ELK
    FeedSvc -.-> ELK
    PostSvc -.-> Jaeger
    FeedSvc -.-> Jaeger
```

**Bảng mô tả vai trò từng component:**

| Component | Vai trò |
|---|---|
| Client (React SPA / Mobile) | UI cho user tạo post, xem feed, tương tác (like/comment/share) |
| CloudFront CDN | Serve media (ảnh/video) từ edge locations, giảm latency và bandwidth cho origin |
| AWS WAF | Bảo vệ DDoS, SQL injection, XSS, rate limiting ở edge |
| ALB | Load balancing L7 giữa API Gateway instances, health check |
| API Gateway | Authentication (JWT), rate limiting, request routing đến đúng service |
| Post Service | Tạo/sửa/xóa post, validate content, publish event post-created tới Kafka |
| Feed Service | Generate personalized feed: đọc từ Redis cache, merge celebrity posts, gọi Ranking Service |
| Fan-out Service | Kafka consumer — nhận post-created events, push post_id đến followers' feed caches trong Redis |
| Social Graph Service | Quản lý follow/unfollow, query followers/following lists |
| Engagement Service | Xử lý like/unlike, comment, share; cập nhật counters |
| Ranking Service | Tính score cho feed items (recency, engagement, affinity), sort feed |
| Notification Service | Gửi push notification (FCM/APNs) khi có post mới hoặc interaction |
| Media Service | Coordinate upload to S3, generate presigned URLs, image resizing triggers |
| PostgreSQL Primary | Source of truth cho posts, users, follows, likes, comments |
| PostgreSQL Replica | Read replicas cho heavy read queries (feed generation fallback, analytics) |
| Redis Cluster | Feed cache (sorted sets), post cache (hashes), social graph cache, celebrity posts cache |
| S3 | Object storage cho media files (ảnh, video thumbnails) |
| Kafka | Event streaming: post-created, engagement events, notification events |
| Prometheus + Grafana | Metrics collection và visualization |
| ELK Stack | Centralized logging |
| Jaeger | Distributed tracing |

## 5. 🔗 Client-Server Connection

### Protocol
| Connection Type | Protocol | Sử dụng ở đâu |
|---|---|---|
| REST API (HTTPS) | HTTP/2 + TLS 1.3 | Tất cả CRUD operations: create post, fetch feed, like, comment, follow |
| WebSocket (WSS) | WS over TLS | Real-time feed updates, new post notifications |
| CDN fetch | HTTPS | Media delivery (ảnh, video thumbnails) từ CloudFront |
| S3 upload | HTTPS (presigned URL) | Direct upload media từ client lên S3 |

### Authentication
- **JWT (JSON Web Token)** cho tất cả API requests — token chứa `user_id`, `roles`, `exp`
- **OAuth2** flow cho third-party login (Google, Facebook, Apple)
- **Refresh token** rotation — access token TTL = 15 min, refresh token TTL = 30 days
- **WebSocket auth**: JWT gửi trong initial handshake query param, validate trước khi upgrade connection
- **Public endpoints**: không cần auth — `/api/v1/auth/login`, `/api/v1/auth/register`, `/api/v1/auth/refresh`
- **Presigned URL**: Media upload dùng S3 presigned URL (TTL = 15 min), không đi qua backend

### Rate Limiting & Throttling
| Role | Endpoint Group | Limit | Algorithm |
|---|---|---|---|
| Anonymous | Auth endpoints | 10 req/min | Sliding window |
| Authenticated (Free) | Create post | 10 posts/hour | Token bucket |
| Authenticated (Free) | Feed fetch | 60 req/min | Sliding window |
| Authenticated (Free) | Like/Comment | 120 req/min | Sliding window |
| Authenticated (Premium) | All endpoints | 2× Free limits | Token bucket |

- Rate limit state lưu trong Redis: `ratelimit:{user_id}:{endpoint_group}`
- Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- Khi exceed: HTTP 429 Too Many Requests

### Idempotency
- **Create post**: Client gửi `Idempotency-Key` header (UUID v4). Server check key trong Redis (TTL = 24h) trước khi tạo post. Nếu đã tồn tại → trả lại response cũ.
- **Like/Unlike**: Idempotent by design — toggle based on current state.
- **Follow/Unfollow**: Idempotent by design — upsert/delete based on current state.
- **Comment**: Dùng `Idempotency-Key` header tương tự create post.

### Connection Patterns
- **Request-Response**: REST API cho tất cả CRUD operations
- **Pub-Sub**: Kafka cho internal event streaming (post-created → fan-out, engagement events)
- **Push**: WebSocket cho real-time notifications — server push "new posts available" badge đến online clients
- **Response Compression**: gzip/brotli cho JSON responses > 1KB, giảm bandwidth `[C7]`

## 6. 🔄 System / App Flow

### Flow 1: Create Post

```mermaid
sequenceDiagram
    actor User
    participant Client as React Client
    participant GW as API Gateway
    participant PS as Post Service
    participant DB as PostgreSQL
    participant K as Kafka
    participant FS as Fan-out Service
    participant R as Redis Cache
    participant NS as Notification Svc
    participant S3 as S3 (Media)

    User->>Client: Tạo post (text + ảnh)

    alt Post có media
        Client->>GW: POST /api/v1/media/presign
        GW->>Client: {uploadUrl, mediaKey}
        Client->>S3: PUT (presigned URL) — upload ảnh
        S3-->>Client: 200 OK
    end

    Client->>GW: POST /api/v1/posts {content, mediaKeys[], idempotencyKey}
    GW->>GW: Validate JWT, Rate limit check
    GW->>PS: Forward request

    PS->>PS: Validate content (length, banned words)
    PS->>PS: Generate Snowflake ID
    PS->>DB: INSERT INTO posts (...)
    DB-->>PS: OK

    PS->>R: SET post:{postId} (cache post details, TTL=24h)
    PS->>K: Publish "post-created" event {postId, userId, createdAt}
    PS-->>GW: 201 Created {post}
    GW-->>Client: 201 Created {post}

    Note over K,FS: Async processing

    K->>FS: Consume "post-created"
    FS->>FS: Check: userId is celebrity? (Redis SET lookup)

    alt Normal User (< 10K followers)
        FS->>FS: Get follower list (from Social Graph cache)
        FS->>R: Pipeline ZADD feed:{followerId} for each follower
        R-->>FS: OK
    else Celebrity User (≥ 10K followers)
        FS->>R: ZADD celebrity_posts:{userId} {postId, timestamp}
        R-->>FS: OK
    end

    K->>NS: Consume "post-created"
    NS->>NS: Get online followers via WebSocket registry
    NS->>Client: Push "new post" notification (WebSocket)
```

### Flow 2: Fetch News Feed

```mermaid
sequenceDiagram
    actor User
    participant Client as React Client
    participant GW as API Gateway
    participant FS as Feed Service
    participant RS as Ranking Service
    participant R as Redis Cache
    participant DB as PostgreSQL (Replica)

    User->>Client: Mở app / Scroll feed
    Client->>GW: GET /api/v1/feed?cursor=xxx&limit=20
    GW->>GW: Validate JWT, Rate limit
    GW->>FS: Forward request

    FS->>R: ZREVRANGEBYSCORE feed:{userId} (get post IDs, cursor-based)

    alt Cache HIT
        R-->>FS: List of post IDs (pre-computed feed)
    else Cache MISS
        R-->>FS: Empty / partial
        FS->>DB: Query posts from followed users (fallback)
        DB-->>FS: Post IDs
        FS->>R: Rebuild feed cache (ZADD batch)
    end

    Note over FS: Merge celebrity posts

    FS->>R: Get celebrity list user follows (SET members)
    R-->>FS: [celebrity_1, celebrity_2, ...]

    loop Each celebrity
        FS->>R: ZREVRANGEBYSCORE celebrity_posts:{celebId} (recent posts)
        R-->>FS: Celebrity post IDs
    end

    FS->>FS: Merge normal feed + celebrity posts (dedup)

    FS->>R: MGET post:{id} for all post IDs (batch fetch post details)

    alt All posts in cache
        R-->>FS: Post details
    else Some cache miss
        R-->>FS: Partial results
        FS->>DB: SELECT * FROM posts WHERE id IN (missing IDs)
        DB-->>FS: Missing post details
        FS->>R: Cache fetched posts (SET post:{id}, TTL=24h)
    end

    FS->>RS: Rank posts (recency, engagement, affinity)
    RS-->>FS: Sorted post list with scores

    FS-->>GW: 200 OK {posts[], nextCursor}
    GW-->>Client: 200 OK {posts[], nextCursor}
    Client->>Client: Render feed, setup infinite scroll
```

### Error Handling & Edge Cases

| Scenario | HTTP Status | Behavior |
|---|---|---|
| Post content empty / quá dài (> 5000 chars) | 400 Bad Request | Validate trước khi persist, trả error message cụ thể |
| Post không tồn tại (deleted / invalid ID) | 404 Not Found | Trả error, remove từ feed cache nếu có |
| Duplicate post (idempotency key conflict) | 200 OK | Trả lại response của post đã tạo trước đó |
| Rate limit exceeded | 429 Too Many Requests | Trả Retry-After header |
| Redis down (feed cache unavailable) | 200 OK (degraded) | Fallback: query PostgreSQL replica directly, feed latency tăng |
| Kafka lag (fan-out delay) | — | Feed có thể thiếu posts mới nhất, client retry sau vài giây |
| Media upload fail (S3 error) | 502 Bad Gateway | Client retry upload, post tạo không có media |
| User blocked/suspended | 403 Forbidden | Không hiển thị posts của user bị block trong feed |
| Celebrity posts cache miss | — | Query PostgreSQL cho recent celebrity posts, rebuild cache |
| Feed cache expired / cold user | 200 OK | Rebuild feed on demand: query following list → fetch recent posts → populate Redis |

> 📌 **Fallback strategy khi Redis down**: Feed Service detect Redis connection failure → switch sang PostgreSQL read replica. Query: `SELECT p.* FROM posts p JOIN follows f ON p.user_id = f.followee_id WHERE f.follower_id = ? ORDER BY p.created_at DESC LIMIT 20`. Latency tăng từ ~50ms lên ~200-500ms nhưng vẫn serve được.

## 7. 📡 API Modeling

### Endpoint Definitions

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/api/v1/posts` | ✅ JWT | Tạo post mới |
| GET | `/api/v1/posts/{postId}` | ✅ JWT | Lấy chi tiết 1 post |
| DELETE | `/api/v1/posts/{postId}` | ✅ JWT (owner) | Xóa post (soft delete) |
| GET | `/api/v1/feed` | ✅ JWT | Lấy personalized news feed |
| POST | `/api/v1/users/{userId}/follow` | ✅ JWT | Follow user |
| DELETE | `/api/v1/users/{userId}/follow` | ✅ JWT | Unfollow user |
| POST | `/api/v1/posts/{postId}/likes` | ✅ JWT | Like post |
| DELETE | `/api/v1/posts/{postId}/likes` | ✅ JWT | Unlike post |
| POST | `/api/v1/posts/{postId}/comments` | ✅ JWT | Comment trên post |
| GET | `/api/v1/posts/{postId}/comments` | ✅ JWT | Lấy danh sách comments |
| POST | `/api/v1/posts/{postId}/shares` | ✅ JWT | Share post |
| POST | `/api/v1/media/presign` | ✅ JWT | Lấy presigned URL để upload media |

### Request/Response Examples

**Create Post:**
```http
POST /api/v1/posts HTTP/2
Host: api.newsfeed.example.com
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000

{
  "content": "Hôm nay trời đẹp quá! ☀️ Đi cafe với bạn bè cuối tuần.",
  "media_keys": ["media/2026/03/01/abc123.jpg"],
  "visibility": "public"
}
```

```http
HTTP/2 201 Created
Content-Type: application/json

{
  "id": "1893456789012345678",
  "user_id": "1893000000000000001",
  "content": "Hôm nay trời đẹp quá! ☀️ Đi cafe với bạn bè cuối tuần.",
  "media_urls": [
    "https://cdn.newsfeed.example.com/media/2026/03/01/abc123_800x600.jpg"
  ],
  "visibility": "public",
  "like_count": 0,
  "comment_count": 0,
  "share_count": 0,
  "created_at": "2026-03-01T10:30:00Z",
  "author": {
    "id": "1893000000000000001",
    "username": "hieptran",
    "display_name": "Hiep Tran",
    "avatar_url": "https://cdn.newsfeed.example.com/avatars/hieptran_64x64.jpg"
  }
}
```

**Fetch Feed (Cursor-based pagination):**
```http
GET /api/v1/feed?cursor=1893456789012345000&limit=20 HTTP/2
Host: api.newsfeed.example.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
Accept-Encoding: gzip
```

```http
HTTP/2 200 OK
Content-Type: application/json
Content-Encoding: gzip
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
X-RateLimit-Reset: 1709290800

{
  "posts": [
    {
      "id": "1893456789012345678",
      "user_id": "1893000000000000042",
      "content": "Just shipped a new feature! 🚀",
      "media_urls": [],
      "visibility": "public",
      "like_count": 234,
      "comment_count": 18,
      "share_count": 5,
      "is_liked": true,
      "feed_score": 0.87,
      "created_at": "2026-03-01T09:15:00Z",
      "author": {
        "id": "1893000000000000042",
        "username": "devfriend",
        "display_name": "Dev Friend",
        "avatar_url": "https://cdn.newsfeed.example.com/avatars/devfriend_64x64.jpg"
      }
    },
    {
      "id": "1893456789012345600",
      "user_id": "1893000000000000007",
      "content": "Sunset at Da Nang beach 🌅",
      "media_urls": [
        "https://cdn.newsfeed.example.com/media/2026/03/01/sunset_800x600.jpg"
      ],
      "visibility": "public",
      "like_count": 1502,
      "comment_count": 89,
      "share_count": 34,
      "is_liked": false,
      "feed_score": 0.82,
      "created_at": "2026-03-01T08:45:00Z",
      "author": {
        "id": "1893000000000000007",
        "username": "traveler_vn",
        "display_name": "Vietnam Traveler",
        "avatar_url": "https://cdn.newsfeed.example.com/avatars/traveler_64x64.jpg"
      }
    }
  ],
  "next_cursor": "1893456789012345599",
  "has_more": true
}
```

**Like Post:**
```http
POST /api/v1/posts/1893456789012345678/likes HTTP/2
Host: api.newsfeed.example.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
```

```http
HTTP/2 201 Created
Content-Type: application/json

{
  "post_id": "1893456789012345678",
  "liked": true,
  "like_count": 235
}
```

**Follow User:**
```http
POST /api/v1/users/1893000000000000042/follow HTTP/2
Host: api.newsfeed.example.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
```

```http
HTTP/2 201 Created
Content-Type: application/json

{
  "follower_id": "1893000000000000001",
  "followee_id": "1893000000000000042",
  "created_at": "2026-03-01T10:35:00Z"
}
```

### Error Response Format
```json
{
  "timestamp": "2026-03-01T10:30:00Z",
  "status": 400,
  "error": "Bad Request",
  "code": "POST_CONTENT_TOO_LONG",
  "message": "Post content must not exceed 5000 characters. Current: 5234 characters.",
  "path": "/api/v1/posts"
}
```

### Pagination Strategy
- **Cursor-based pagination** (không dùng offset-based)
- Lý do: offset-based có vấn đề khi data thay đổi liên tục (new posts pushed vào feed → offset bị shift, gây duplicate hoặc missing posts)
- Cursor = last post ID (Snowflake ID, sortable) → `WHERE id < cursor ORDER BY id DESC LIMIT 20`
- Redis: `ZREVRANGEBYSCORE feed:{userId} cursor +inf LIMIT 0 20`
- Default `limit = 20`, max `limit = 50`

### API Versioning
- **Path-based**: `/api/v1/...`
- Deprecation policy: khi có v2, v1 dual-run tối thiểu 6 tháng
- Response header: `X-API-Version: v1`, `Deprecation: true` (khi deprecated)

## 8. 🗄️ Data Modeling

### Database Schema

**Users table:**
```sql
CREATE TABLE users (
    user_id         BIGINT PRIMARY KEY,              -- Snowflake ID
    username        VARCHAR(30) NOT NULL UNIQUE,
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    display_name    VARCHAR(100) NOT NULL,
    avatar_url      VARCHAR(500),
    bio             VARCHAR(500),
    follower_count  INT NOT NULL DEFAULT 0,
    following_count INT NOT NULL DEFAULT 0,
    is_celebrity    BOOLEAN NOT NULL DEFAULT FALSE,   -- flag khi follower_count >= 10,000
    status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_username ON users (username);
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_celebrity ON users (is_celebrity) WHERE is_celebrity = TRUE;
```

**Posts table (partitioned by month):**
```sql
CREATE TABLE posts (
    post_id         BIGINT NOT NULL,                  -- Snowflake ID
    user_id         BIGINT NOT NULL REFERENCES users(user_id),
    content         TEXT,
    media_urls      JSONB DEFAULT '[]'::JSONB,        -- ["url1", "url2"]
    post_type       VARCHAR(20) NOT NULL DEFAULT 'ORIGINAL'
                    CHECK (post_type IN ('ORIGINAL', 'SHARE', 'REPLY')),
    visibility      VARCHAR(20) NOT NULL DEFAULT 'PUBLIC'
                    CHECK (visibility IN ('PUBLIC', 'FOLLOWERS_ONLY', 'PRIVATE')),
    original_post_id BIGINT,                          -- for shares/reposts
    like_count      INT NOT NULL DEFAULT 0,
    comment_count   INT NOT NULL DEFAULT 0,
    share_count     INT NOT NULL DEFAULT 0,
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (post_id, created_at)
) PARTITION BY RANGE (created_at);

-- Monthly partitions
CREATE TABLE posts_2026_03 PARTITION OF posts
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE posts_2026_04 PARTITION OF posts
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
-- ... auto-create via pg_partman

CREATE INDEX idx_posts_user_created ON posts (user_id, created_at DESC);
CREATE INDEX idx_posts_created ON posts (created_at DESC);
CREATE INDEX idx_posts_type ON posts (post_type) WHERE post_type = 'SHARE';
```

> 💡 **Tại sao partition by month?** Với ~27.4TB/year `[C4]`, mỗi monthly partition ≈ 2.3TB. Partition pruning giúp queries trên posts gần đây chỉ scan 1-2 partitions thay vì toàn bộ. Old partitions (> 1 năm) có thể detach + archive sang cold storage.

**Follows table (Social Graph):**
```sql
CREATE TABLE follows (
    follower_id     BIGINT NOT NULL REFERENCES users(user_id),
    followee_id     BIGINT NOT NULL REFERENCES users(user_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, followee_id)
);

-- Query: "Ai follow user X?" (để fan-out)
CREATE INDEX idx_follows_followee ON follows (followee_id, follower_id);
-- Query: "User X follow ai?" (để fetch celebrity list khi build feed)
-- PK (follower_id, followee_id) đã cover query này
```

> 💡 **Social Graph indexing**: PK `(follower_id, followee_id)` phục vụ query "User X follows whom?" (feed generation). Index `(followee_id, follower_id)` phục vụ query "Who follows user X?" (fan-out service cần list followers).

**Likes table:**
```sql
CREATE TABLE likes (
    user_id         BIGINT NOT NULL REFERENCES users(user_id),
    post_id         BIGINT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, post_id)
);

CREATE INDEX idx_likes_post ON likes (post_id, created_at DESC);
```

**Comments table:**
```sql
CREATE TABLE comments (
    comment_id      BIGINT PRIMARY KEY,               -- Snowflake ID
    post_id         BIGINT NOT NULL,
    user_id         BIGINT NOT NULL REFERENCES users(user_id),
    content         TEXT NOT NULL,
    parent_comment_id BIGINT,                          -- NULL = top-level, else = reply
    like_count      INT NOT NULL DEFAULT 0,
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comments_post ON comments (post_id, created_at ASC);
CREATE INDEX idx_comments_parent ON comments (parent_comment_id) WHERE parent_comment_id IS NOT NULL;
```

**Shares table:**
```sql
CREATE TABLE shares (
    share_id        BIGINT PRIMARY KEY,                -- Snowflake ID
    post_id         BIGINT NOT NULL,
    user_id         BIGINT NOT NULL REFERENCES users(user_id),
    comment         TEXT,                              -- optional comment khi share
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shares_post ON shares (post_id, created_at DESC);
CREATE INDEX idx_shares_user ON shares (user_id, created_at DESC);
```

### ER Diagram

```mermaid
erDiagram
    USERS {
        bigint user_id PK
        varchar username UK
        varchar email UK
        varchar password_hash
        varchar display_name
        varchar avatar_url
        varchar bio
        int follower_count
        int following_count
        boolean is_celebrity
        varchar status
        timestamptz created_at
        timestamptz updated_at
    }

    POSTS {
        bigint post_id PK
        bigint user_id FK
        text content
        jsonb media_urls
        varchar post_type
        varchar visibility
        bigint original_post_id FK
        int like_count
        int comment_count
        int share_count
        boolean is_deleted
        timestamptz created_at
        timestamptz updated_at
    }

    FOLLOWS {
        bigint follower_id PK_FK
        bigint followee_id PK_FK
        timestamptz created_at
    }

    LIKES {
        bigint user_id PK_FK
        bigint post_id PK_FK
        timestamptz created_at
    }

    COMMENTS {
        bigint comment_id PK
        bigint post_id FK
        bigint user_id FK
        text content
        bigint parent_comment_id FK
        int like_count
        boolean is_deleted
        timestamptz created_at
        timestamptz updated_at
    }

    SHARES {
        bigint share_id PK
        bigint post_id FK
        bigint user_id FK
        text comment
        timestamptz created_at
    }

    USERS ||--o{ POSTS : "creates"
    USERS ||--o{ FOLLOWS : "follower"
    USERS ||--o{ FOLLOWS : "followee"
    USERS ||--o{ LIKES : "likes"
    USERS ||--o{ COMMENTS : "writes"
    USERS ||--o{ SHARES : "shares"
    POSTS ||--o{ LIKES : "has"
    POSTS ||--o{ COMMENTS : "has"
    POSTS ||--o{ SHARES : "has"
    POSTS ||--o| POSTS : "original (share/repost)"
    COMMENTS ||--o{ COMMENTS : "replies to"
```

### Indexing Strategy

| Index | Columns | Loại | Phục vụ query pattern |
|---|---|---|---|
| `idx_users_username` | `username` | Unique | Login, profile lookup by username |
| `idx_users_email` | `email` | Unique | Login, email verification |
| `idx_users_celebrity` | `is_celebrity` WHERE `is_celebrity = TRUE` | Partial | Fan-out Service check celebrity status nhanh |
| `idx_posts_user_created` | `(user_id, created_at DESC)` | Composite | User profile page: "posts của user X" |
| `idx_posts_created` | `(created_at DESC)` | Simple | Feed generation fallback (query recent posts) |
| `idx_follows_followee` | `(followee_id, follower_id)` | Composite | Fan-out: "list followers of user X" |
| PK follows | `(follower_id, followee_id)` | Composite PK | Feed: "user X follows whom?" |
| `idx_likes_post` | `(post_id, created_at DESC)` | Composite | "Ai like post này?" list |
| `idx_comments_post` | `(post_id, created_at ASC)` | Composite | Comments list cho 1 post (chronological) |
| `idx_comments_parent` | `(parent_comment_id)` WHERE NOT NULL | Partial | Nested replies lookup |
| `idx_shares_post` | `(post_id, created_at DESC)` | Composite | Share count / list shares |
| `idx_shares_user` | `(user_id, created_at DESC)` | Composite | User profile: "posts user X đã share" |

### Partitioning / Sharding Strategy

**Posts table — Range partition by `created_at` (monthly):**
- Mỗi partition ≈ 2.3TB/month `[C4: 27.4TB/year ÷ 12]`
- Queries feed luôn filter theo thời gian → partition pruning hiệu quả
- `pg_partman` tự động tạo future partitions và detach old ones

**Khi nào cần shard?**
- Threshold: khi single PostgreSQL instance không handle được write QPS + storage
- Với peak write 2,894 QPS `[C1]`, PostgreSQL (with connection pooling via PgBouncer) xử lý tốt
- Nếu vượt ~10K write QPS: shard by `user_id` (hash) qua application-level routing (Vitess hoặc Citus)
- Shard key = `user_id` — đảm bảo posts của cùng user nằm cùng shard (locality cho profile page queries)

**Follows table — Potential sharding:**
- Với 100M users × 200 avg follows = 20B rows — lớn nhưng mỗi row chỉ ~24B
- Shard by `follower_id` nếu cần — fan-out query "followers of user X" cần scatter-gather cross-shard
- Ban đầu: single PostgreSQL + read replicas, shard khi > 50B rows

### Data Retention Policy

| Data | Retention | Strategy |
|---|---|---|
| Posts (active) | Vĩnh viễn (public) | Partition pruning, nhưng keep data |
| Posts (deleted) | 30 ngày soft delete → hard delete | `is_deleted = TRUE`, cron job cleanup |
| Feed cache (Redis) | 7 ngày TTL per user | Redis TTL, rebuild on access nếu expired |
| Celebrity posts cache | 48h TTL | Auto-expire, rebuild from DB |
| Post detail cache | 24h TTL | Cache-aside pattern |
| Media (S3) | Standard 90 ngày → IA 1 năm → Glacier | S3 lifecycle policy |
| Likes/Comments | Vĩnh viễn | Archive old data (> 2 năm) sang read-only partition |
| Engagement counters | Vĩnh viễn | Denormalized trong posts table |

> 💡 **Feed cache TTL = 7 ngày**: Active users (truy cập ít nhất 1 lần/7 ngày) luôn có warm cache. Inactive users → cache expire → rebuild on next access (cold start latency ~500ms, chấp nhận được vì user quay lại sau lâu).

### Redis Data Structures

```
# Feed cache — sorted set per user
# Key: feed:{user_id}
# Score: post created_at timestamp (epoch millis)
# Value: post_id (string)
# TTL: 7 days, reset on access
ZADD feed:1893000000000000001 1709283000000 "1893456789012345678"
ZADD feed:1893000000000000001 1709282700000 "1893456789012345600"
ZREVRANGEBYSCORE feed:1893000000000000001 +inf 1709282700000 LIMIT 0 20

# Celebrity posts cache — sorted set per celebrity
# Key: celebrity_posts:{user_id}
# TTL: 48 hours
ZADD celebrity_posts:1893000000000000099 1709283000000 "1893456789099345678"

# Post detail cache — hash per post
# Key: post:{post_id}
# TTL: 24 hours
HSET post:1893456789012345678 content "Hôm nay trời đẹp!" user_id "1893000000000000001" ...

# User profile cache — hash per user
# Key: user:{user_id}
# TTL: 1 hour
HSET user:1893000000000000001 username "hieptran" display_name "Hiep Tran" ...

# Social graph cache — set per user
# Key: following:{user_id} — set of followee IDs
# TTL: 1 hour
SADD following:1893000000000000001 "1893000000000000042" "1893000000000000007"

# Celebrity set — global set of all celebrity user IDs
# Key: celebrity_set
# No TTL, updated by Social Graph Service when follower_count crosses threshold
SADD celebrity_set "1893000000000000099" "1893000000000000100"
```

## 9. ⚙️ Manager Classes / Services

### Service Decomposition

| Service | Vai trò | Tech |
|---|---|---|
| Post Service | CRUD posts, content validation, publish events | Spring Boot, PostgreSQL |
| Feed Service | Generate & serve personalized feed, merge celebrity posts | Spring Boot, Redis, PostgreSQL (fallback) |
| Fan-out Service | Kafka consumer, distribute posts đến follower feed caches | Spring Boot, Kafka, Redis |
| Social Graph Service | Follow/unfollow, query followers/following, manage celebrity flag | Spring Boot, PostgreSQL, Redis |
| Engagement Service | Like/unlike, comment, share, update counters | Spring Boot, PostgreSQL, Redis, Kafka |
| Ranking Service | Calculate feed scores (recency, engagement, affinity) | Spring Boot (internal library, co-located with Feed Service) |
| Notification Service | Push notifications (FCM/APNs), WebSocket management | Spring Boot, Kafka, WebSocket |
| Media Service | Presigned URL generation, image processing triggers | Spring Boot, S3, Lambda (resize) |

### Core Service Classes & Responsibilities

| Class | Annotation | Responsibility |
|---|---|---|
| `PostService` | `@Service` | Tạo/sửa/xóa post, validate content, publish Kafka events |
| `FeedService` | `@Service` | Orchestrate feed generation: Redis read → celebrity merge → ranking |
| `FanoutWorker` | `@Component` | Kafka consumer, fan-out post IDs đến followers' Redis feeds |
| `SocialGraphService` | `@Service` | Follow/unfollow, query social graph, manage celebrity flag |
| `EngagementService` | `@Service` | Like/comment/share, update counters (async via Kafka) |
| `FeedRankingEngine` | `@Component` | Tính score cho feed items, sort by score |
| `SnowflakeIdGenerator` | `@Component` | Generate unique 64-bit IDs (timestamp + worker + sequence) |
| `RedisFeedRepository` | `@Component` | Abstraction layer cho Redis feed operations (ZADD, ZRANGE, pipeline) |
| `CacheWarmupService` | `@Component` | Rebuild feed cache cho cold users on demand |
| `PostEventPublisher` | `@Component` | Publish post-created / post-deleted events to Kafka |
| `KafkaConfig` | `@Configuration` | Kafka producer/consumer config, topic definitions |
| `RedisConfig` | `@Configuration` | Redis cluster connection, serialization config |
| `MetricsAspect` | `@Aspect` | AOP-based metrics collection (latency, error rate per method) |

### Backend Code Example — FeedService (Java / Spring Boot)

```java
@Service
@RequiredArgsConstructor
@Slf4j
public class FeedService {

    private final RedisFeedRepository redisFeedRepo;
    private final SocialGraphService socialGraphService;
    private final PostRepository postRepository;
    private final FeedRankingEngine rankingEngine;

    private static final int DEFAULT_FEED_SIZE = 20;
    private static final int MAX_CELEBRITY_POSTS = 50;
    private static final int FEED_CACHE_REBUILD_SIZE = 500;

    /**
     * Lấy personalized feed cho user, hybrid fan-out:
     * 1. Đọc pre-computed feed từ Redis (normal users' posts)
     * 2. Pull recent posts từ celebrities mà user follow
     * 3. Merge + rank + paginate
     */
    public FeedResponse getFeed(Long userId, Long cursor, int limit) {
        limit = Math.min(limit, 50);

        // Step 1: Lấy pre-computed feed từ Redis
        List<Long> feedPostIds = redisFeedRepo.getFeedPostIds(userId, cursor, limit + MAX_CELEBRITY_POSTS);

        // Nếu feed cache empty → cold start, rebuild
        if (feedPostIds.isEmpty()) {
            feedPostIds = rebuildFeedCache(userId);
        }

        // Step 2: Pull celebrity posts
        Set<Long> celebrityIds = socialGraphService.getFollowedCelebrities(userId);
        List<Long> celebrityPostIds = new ArrayList<>();
        for (Long celebId : celebrityIds) {
            List<Long> celebPosts = redisFeedRepo.getCelebrityPostIds(celebId, cursor, 10);
            celebrityPostIds.addAll(celebPosts);
        }

        // Step 3: Merge + dedup
        Set<Long> allPostIds = new LinkedHashSet<>(feedPostIds);
        allPostIds.addAll(celebrityPostIds);

        // Step 4: Batch fetch post details (cache-aside: Redis → DB)
        List<Post> posts = fetchPostDetails(new ArrayList<>(allPostIds));

        // Step 5: Filter deleted/blocked posts
        posts = posts.stream()
                .filter(p -> !p.isDeleted())
                .filter(p -> !isBlockedUser(userId, p.getUserId()))
                .collect(Collectors.toList());

        // Step 6: Rank
        List<RankedPost> rankedPosts = rankingEngine.rank(posts, userId);

        // Step 7: Paginate
        List<RankedPost> page = rankedPosts.stream()
                .limit(limit)
                .collect(Collectors.toList());

        Long nextCursor = page.isEmpty() ? null :
                page.get(page.size() - 1).getPost().getPostId();

        return new FeedResponse(
                page.stream().map(this::toPostDto).collect(Collectors.toList()),
                nextCursor,
                rankedPosts.size() > limit
        );
    }

    /**
     * Rebuild feed cache cho cold user (cache miss / expired).
     * Query following list → fetch recent posts → populate Redis sorted set.
     */
    private List<Long> rebuildFeedCache(Long userId) {
        log.info("Rebuilding feed cache for user {}", userId);

        List<Long> followingIds = socialGraphService.getFollowingIds(userId);
        if (followingIds.isEmpty()) {
            return Collections.emptyList();
        }

        // Query recent posts từ followed users (exclude celebrities — handled separately)
        List<Long> normalFollowingIds = followingIds.stream()
                .filter(id -> !socialGraphService.isCelebrity(id))
                .collect(Collectors.toList());

        List<Post> recentPosts = postRepository
                .findRecentPostsByUserIds(normalFollowingIds, FEED_CACHE_REBUILD_SIZE);

        // Populate Redis feed cache
        if (!recentPosts.isEmpty()) {
            redisFeedRepo.rebuildFeed(userId, recentPosts);
        }

        return recentPosts.stream()
                .map(Post::getPostId)
                .collect(Collectors.toList());
    }

    /**
     * Batch fetch post details: check Redis cache first, fallback to DB for misses.
     */
    private List<Post> fetchPostDetails(List<Long> postIds) {
        // Multi-get from Redis
        Map<Long, Post> cached = redisFeedRepo.getPostDetails(postIds);

        // Find cache misses
        List<Long> missIds = postIds.stream()
                .filter(id -> !cached.containsKey(id))
                .collect(Collectors.toList());

        if (!missIds.isEmpty()) {
            List<Post> fromDb = postRepository.findAllById(missIds);
            // Populate cache for misses
            fromDb.forEach(post -> redisFeedRepo.cachePostDetail(post));
            fromDb.forEach(post -> cached.put(post.getPostId(), post));
        }

        // Return in original order
        return postIds.stream()
                .map(cached::get)
                .filter(Objects::nonNull)
                .collect(Collectors.toList());
    }

    private boolean isBlockedUser(Long viewerId, Long authorId) {
        // Simplified — in production would check block list from cache
        return false;
    }

    private PostDto toPostDto(RankedPost rankedPost) {
        Post post = rankedPost.getPost();
        return PostDto.builder()
                .id(post.getPostId().toString())
                .userId(post.getUserId().toString())
                .content(post.getContent())
                .mediaUrls(post.getMediaUrls())
                .visibility(post.getVisibility())
                .likeCount(post.getLikeCount())
                .commentCount(post.getCommentCount())
                .shareCount(post.getShareCount())
                .feedScore(rankedPost.getScore())
                .createdAt(post.getCreatedAt())
                .build();
    }
}
```

### Backend Code Example — FanoutWorker (Kafka Consumer)

```java
@Component
@RequiredArgsConstructor
@Slf4j
public class FanoutWorker {

    private final SocialGraphService socialGraphService;
    private final RedisFeedRepository redisFeedRepo;

    private static final int FANOUT_BATCH_SIZE = 1000;

    @KafkaListener(
        topics = "post-created",
        groupId = "fanout-service",
        concurrency = "32"  // 32 consumers cho ~573K writes/s peak [C3]
    )
    public void onPostCreated(PostCreatedEvent event) {
        Long userId = event.getUserId();
        Long postId = event.getPostId();
        long createdAt = event.getCreatedAt().toEpochMilli();

        // Celebrity check — skip fan-out for celebrities
        if (socialGraphService.isCelebrity(userId)) {
            redisFeedRepo.addCelebrityPost(userId, postId, createdAt);
            log.debug("Celebrity post {} cached (skip fan-out)", postId);
            return;
        }

        // Normal user — fan-out on write
        List<Long> followerIds = socialGraphService.getFollowers(userId);
        log.info("Fan-out post {} to {} followers", postId, followerIds.size());

        // Batch pipeline ZADD cho hiệu quả
        Lists.partition(followerIds, FANOUT_BATCH_SIZE).forEach(batch -> {
            redisFeedRepo.fanoutToFeeds(batch, postId, createdAt);
        });
    }
}
```

### Backend Code Example — FeedRankingEngine

```java
@Component
public class FeedRankingEngine {

    private static final double W_RECENCY = 0.4;
    private static final double W_ENGAGEMENT = 0.3;
    private static final double W_AFFINITY = 0.2;
    private static final double W_TYPE_BONUS = 0.1;
    private static final long TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000L;

    public List<RankedPost> rank(List<Post> posts, Long viewerId) {
        return posts.stream()
                .map(post -> new RankedPost(post, calculateScore(post, viewerId)))
                .sorted(Comparator.comparingDouble(RankedPost::getScore).reversed())
                .collect(Collectors.toList());
    }

    private double calculateScore(Post post, Long viewerId) {
        double recency = calculateRecency(post.getCreatedAt());
        double engagement = calculateEngagement(post);
        double affinity = calculateAffinity(viewerId, post.getUserId());
        double typeBonus = post.getMediaUrls() != null && !post.getMediaUrls().isEmpty()
                ? 1.0 : 0.0;

        return W_RECENCY * recency
             + W_ENGAGEMENT * engagement
             + W_AFFINITY * affinity
             + W_TYPE_BONUS * typeBonus;
    }

    private double calculateRecency(Instant createdAt) {
        long ageMs = Instant.now().toEpochMilli() - createdAt.toEpochMilli();
        return Math.max(0.0, 1.0 - (double) ageMs / TWENTY_FOUR_HOURS_MS);
    }

    private double calculateEngagement(Post post) {
        double raw = post.getLikeCount() + 2.0 * post.getCommentCount() + 3.0 * post.getShareCount();
        return Math.log(1 + raw) / Math.log(2); // log2 scale
    }

    private double calculateAffinity(Long viewerId, Long authorId) {
        // Simplified — in production, query interaction history cache
        // affinity = f(recent likes on author's posts, comments, profile visits)
        return 0.5; // default moderate affinity
    }
}
```

### Frontend Code Example — NewsFeed Component (React + TypeScript)

```tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';

interface Post {
  id: string;
  userId: string;
  content: string;
  mediaUrls: string[];
  likeCount: number;
  commentCount: number;
  shareCount: number;
  isLiked: boolean;
  feedScore: number;
  createdAt: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
  };
}

interface FeedResponse {
  posts: Post[];
  nextCursor: string | null;
  hasMore: boolean;
}

const NewsFeed: React.FC = () => {
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const fetchFeed = useCallback(async (currentCursor: string | null) => {
    if (loading) return;
    setLoading(true);

    try {
      const params = new URLSearchParams({ limit: '20' });
      if (currentCursor) params.append('cursor', currentCursor);

      const res = await fetch(`/api/v1/feed?${params}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });

      if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`);

      const data: FeedResponse = await res.json();
      setPosts(prev => currentCursor ? [...prev, ...data.posts] : data.posts);
      setCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch (err) {
      console.error('Failed to fetch feed:', err);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  // Initial load
  useEffect(() => {
    fetchFeed(null);
  }, []);

  // Infinite scroll — IntersectionObserver
  const lastPostRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (loading) return;
      if (observerRef.current) observerRef.current.disconnect();

      observerRef.current = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && hasMore) {
          fetchFeed(cursor);
        }
      });

      if (node) observerRef.current.observe(node);
    },
    [loading, hasMore, cursor, fetchFeed]
  );

  const handleLike = async (postId: string, isLiked: boolean) => {
    const method = isLiked ? 'DELETE' : 'POST';
    await fetch(`/api/v1/posts/${postId}/likes`, {
      method,
      headers: { Authorization: `Bearer ${getToken()}` },
    });

    setPosts(prev =>
      prev.map(p =>
        p.id === postId
          ? { ...p, isLiked: !isLiked, likeCount: p.likeCount + (isLiked ? -1 : 1) }
          : p
      )
    );
  };

  return (
    <div className="feed-container">
      {posts.map((post, index) => (
        <div
          key={post.id}
          className="post-card"
          ref={index === posts.length - 1 ? lastPostRef : null}
        >
          <div className="post-header">
            <img src={post.author.avatarUrl} alt={post.author.displayName} className="avatar" />
            <div>
              <strong>{post.author.displayName}</strong>
              <span className="timestamp">{formatTime(post.createdAt)}</span>
            </div>
          </div>
          <p className="post-content">{post.content}</p>
          {post.mediaUrls.length > 0 && (
            <div className="post-media">
              {post.mediaUrls.map((url, i) => (
                <img key={i} src={url} alt="post media" loading="lazy" />
              ))}
            </div>
          )}
          <div className="post-actions">
            <button onClick={() => handleLike(post.id, post.isLiked)}>
              {post.isLiked ? '❤️' : '🤍'} {post.likeCount}
            </button>
            <button>💬 {post.commentCount}</button>
            <button>🔄 {post.shareCount}</button>
          </div>
        </div>
      ))}
      {loading && <div className="loading-spinner">Loading...</div>}
    </div>
  );
};

function getToken(): string {
  return localStorage.getItem('access_token') || '';
}

function formatTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default NewsFeed;
```

### Service Communication Patterns

| Source | Target | Pattern | Protocol | Mô tả |
|---|---|---|---|---|
| Post Service | Kafka | Async | Kafka producer | Publish post-created event |
| Kafka | Fan-out Service | Async | Kafka consumer | Consume post-created → fan-out |
| Kafka | Notification Service | Async | Kafka consumer | Consume events → push notifications |
| Feed Service | Redis | Sync | Redis protocol | Read feed cache, post cache |
| Feed Service | PostgreSQL (Replica) | Sync | JDBC | Fallback khi cache miss |
| Feed Service | Ranking Service | Sync (in-process) | Method call | Ranking engine co-located với Feed Service |
| Social Graph Service | Redis | Sync | Redis protocol | Cache following/follower lists |
| Social Graph Service | PostgreSQL | Sync | JDBC | Source of truth cho social graph |
| Engagement Service | Kafka | Async | Kafka producer | Publish engagement events (for analytics) |
| Engagement Service | Redis | Sync | Redis protocol | Update cached counters |
| Media Service | S3 | Sync | AWS SDK | Generate presigned URLs, manage objects |

> 📌 **Shared libraries**: Tất cả services share common libraries: `common-model` (DTOs, events), `common-security` (JWT filter), `common-observability` (metrics, tracing config), `common-redis` (Redis utilities), `snowflake-id-generator`.

## 10. 🏛️ Architecture Design

### Architecture Pattern
- **Microservices architecture** — mỗi domain (Post, Feed, Social Graph, Engagement) là một service độc lập
- **Event-driven** cho write path: Post Service publish events → Kafka → Fan-out Service / Notification Service consume
- **Cache-heavy read path**: Feed Service đọc chủ yếu từ Redis, fallback PostgreSQL replica
- **CQRS-lite**: Write path (create post) và read path (fetch feed) tách biệt, tối ưu riêng

### Architecture Diagram

```mermaid
flowchart TB
    subgraph Internet["🌐 Internet"]
        Browser["📱 Browser / Mobile App"]
    end

    subgraph AWS_Edge["AWS Edge"]
        R53["Route53\n(DNS)"]
        CF["CloudFront\n(CDN - Media)"]
        WAF2["AWS WAF\n(DDoS, Bot)"]
    end

    subgraph AWS_VPC["AWS VPC (ap-southeast-1)"]
        subgraph Public_Subnet["Public Subnet"]
            ALB2["ALB\n(L7 Load Balancer)"]
        end

        subgraph EKS["EKS Cluster"]
            APIGW2["API Gateway Pod\n(Auth, Rate Limit)"]

            subgraph Write_Path["Write Path"]
                PS2["Post Service\n(3-10 pods)"]
                SS2["Social Graph Service\n(3-8 pods)"]
                ES2["Engagement Service\n(3-10 pods)"]
                MS2["Media Service\n(2-5 pods)"]
            end

            subgraph Read_Path["Read Path"]
                FS2["Feed Service\n(8-40 pods)"]
                RS2["Ranking Engine\n(co-located)"]
            end

            subgraph Async_Workers["Async Workers"]
                FW2["Fan-out Workers\n(10-50 pods)"]
                NW2["Notification Workers\n(3-10 pods)"]
            end
        end

        subgraph Data_Layer["Data Layer"]
            subgraph PostgreSQL_Cluster["PostgreSQL (RDS)"]
                PG_P["Primary\n(r6g.2xlarge)"]
                PG_R1["Replica 1\n(Read)"]
                PG_R2["Replica 2\n(Read)"]
            end

            subgraph Redis_Cluster2["Redis Cluster (ElastiCache)"]
                RC1["Shard 1-10\n(Feed cache)"]
                RC2["Shard 11-15\n(Post cache)"]
                RC3["Shard 16-20\n(Social cache)"]
            end

            subgraph Kafka_Cluster["MSK (Kafka)"]
                KT1["post-created\n(32 partitions)"]
                KT2["engagement\n(16 partitions)"]
                KT3["notification\n(8 partitions)"]
            end

            S3_2["S3\n(Media storage)"]
        end

        subgraph Observability2["Observability"]
            CW["CloudWatch"]
            PROM["Prometheus\n+ Grafana"]
            ELK2["OpenSearch\n(Logging)"]
            XRAY["X-Ray / Jaeger\n(Tracing)"]
        end
    end

    Browser --> R53 --> CF
    Browser --> R53 --> WAF2 --> ALB2
    CF --> S3_2

    ALB2 --> APIGW2
    APIGW2 --> PS2
    APIGW2 --> FS2
    APIGW2 --> SS2
    APIGW2 --> ES2
    APIGW2 --> MS2

    PS2 --> PG_P
    PS2 --> KT1
    SS2 --> PG_P
    SS2 --> RC3
    ES2 --> PG_P
    ES2 --> RC2
    ES2 --> KT2
    MS2 --> S3_2

    FS2 --> RC1
    FS2 --> RC2
    FS2 --> PG_R1
    FS2 --> RS2

    KT1 --> FW2
    FW2 --> RC1
    FW2 --> RC3
    KT2 --> NW2
    KT3 --> NW2

    PG_P --> PG_R1
    PG_P --> PG_R2

    PS2 -.-> PROM
    FS2 -.-> PROM
    FW2 -.-> PROM
    PS2 -.-> ELK2
    FS2 -.-> ELK2
    PS2 -.-> XRAY
    FS2 -.-> XRAY
    PROM -.-> CW
```

### Scaling Strategy

**Horizontal Pod Autoscaler (HPA):**

| Service | Min Pods | Max Pods | Scale Metric | Threshold |
|---|---|---|---|---|
| API Gateway | 4 | 20 | CPU utilization | 60% |
| Post Service | 3 | 10 | CPU utilization | 70% — peak 2,894 QPS `[C1]` |
| Feed Service | 8 | 40 | RPS per pod | 1,200 req/s — peak 46,296 QPS `[C2]` |
| Fan-out Workers | 10 | 50 | Kafka consumer lag | > 10,000 messages `[C3]` |
| Social Graph Service | 3 | 8 | CPU utilization | 70% |
| Engagement Service | 3 | 10 | CPU utilization | 70% |
| Notification Workers | 3 | 10 | Kafka consumer lag | > 5,000 messages |
| Media Service | 2 | 5 | CPU utilization | 60% |

**Database Scaling:**
- PostgreSQL Primary: `r6g.2xlarge` (8 vCPU, 64GB RAM) → scale up to `r6g.4xlarge` khi write QPS > 5K
- Read Replicas: 2 replicas cho read-heavy Feed Service fallback + analytics queries
- Connection pooling: PgBouncer (transaction mode), max 200 connections per replica
- Khi vượt 10K write QPS: xem xét Citus/Vitess sharding by `user_id`

**Redis Cluster Scaling:**
- 20 shards × `r6g.2xlarge` (52GB) = ~1TB total capacity `[C6]`
- Shard rebalancing khi utilization > 75%
- Memory alert threshold: 80% → add shard hoặc tăng instance size

### Caching Strategy

**Multi-layer caching:**

| Layer | Technology | Cached Data | TTL | Hit Ratio Target |
|---|---|---|---|---|
| L1 — CDN | CloudFront | Media (ảnh, thumbnails) | 7 days | > 95% |
| L2 — Application | Redis Cluster | Feed cache, Post details, User profiles, Social graph | 24h-7d | > 90% |
| L3 — DB | PostgreSQL (with shared_buffers) | Hot rows in buffer pool | N/A | > 80% |

**Eviction & Invalidation:**
- **Feed cache**: TTL = 7 days, ZADD auto-update khi có post mới (fan-out). ZREMRANGEBYRANK trim feed > 500 entries.
- **Post detail cache**: TTL = 24h. Invalidate on post update/delete (publish cache-invalidation event).
- **User profile cache**: TTL = 1h. Invalidate on profile update.
- **Social graph cache**: TTL = 1h. Invalidate on follow/unfollow.
- **Celebrity posts cache**: TTL = 48h. Auto-append on new post.

> 📌 **Cache stampede prevention**: Sử dụng Redis `SET ... NX EX` (lock) khi rebuild cache cho cold users. Chỉ 1 request rebuild, các request khác wait hoặc serve stale data.

### Load Balancing / Gateway

- **ALB (Application Load Balancer)**: L7 routing, health check `/health` every 10s, deregistration delay 30s
- **API Gateway** (custom Spring Cloud Gateway hoặc Kong):
  - JWT validation
  - Rate limiting (Redis-backed token bucket)
  - Request routing by path prefix (`/posts/**` → Post Service, `/feed/**` → Feed Service)
  - Request/response logging
  - Circuit breaker per downstream service

### Resilience Patterns

| Pattern | Áp dụng | Chi tiết |
|---|---|---|
| **Circuit Breaker** | Feed Service → Redis, Feed Service → DB | Failure threshold: 5 failures / 30s → OPEN (30s) → HALF-OPEN (allow 3 probes). Fallback: serve stale cache hoặc empty feed với "try again" message. |
| **Retry with Backoff** | Post Service → DB, Fan-out → Redis | Max 3 retries, exponential backoff (100ms, 200ms, 400ms) + jitter (±50ms). Chỉ retry cho transient errors (connection timeout, 503). |
| **Bulkhead** | Feed Service thread pools | Separate thread pool cho Redis calls (50 threads) vs DB calls (20 threads). Tránh DB slowness block Redis path. |
| **Timeout** | Tất cả inter-service calls | Feed→Redis: 50ms, Feed→DB: 200ms, Post→DB: 300ms, Fan-out→Redis: 100ms per batch. |
| **Graceful Degradation** | Feed Service khi Redis down | Serve feed từ PostgreSQL replica (latency tăng ~5x nhưng vẫn hoạt động). Feed quality giảm (chronological thay vì ranked). |
| **Request Coalescing** | Cache rebuild cho hot users | Khi nhiều requests cùng trigger cache rebuild cho 1 user → chỉ 1 request thực thi rebuild, còn lại wait (Redis SETNX lock). |

## 11. 🧪 Testing Strategy

| Test Type | Framework/Tool | Scope | Coverage Target |
|---|---|---|---|
| **Unit Testing** | JUnit 5, Mockito | Service logic, ranking engine, ID generator | > 85% line coverage |
| **Integration Testing** | Spring Boot Test, Testcontainers | Service ↔ PostgreSQL, Redis, Kafka | All critical paths |
| **API Contract Testing** | Spring Cloud Contract | Inter-service API compatibility | All public endpoints |
| **Load Testing** | k6, Gatling | Feed fetch throughput, fan-out throughput | Peak QPS targets `[C2]`, `[C3]` |
| **Chaos Engineering** | Chaos Mesh (K8s) | Redis node failure, Kafka partition leader change, DB failover | 3 failure scenarios / quarter |
| **E2E Testing** | Cypress, Playwright | Create post → appears in follower feed, Like/Comment flow | Top 5 user journeys |

**Load Test kịch bản cụ thể:**
1. **Feed fetch under peak**: 46K RPS sustained 10 min, assert p95 < 200ms, p99 < 500ms `[C2]`
2. **Fan-out burst**: 1 celebrity post (simulate 100K follower pull on read), assert feed latency < 300ms
3. **Mixed workload**: 80% read + 20% write, sustained 30 min at peak, assert error rate < 0.1%

**Chaos Engineering scenarios:**
1. Kill 1 Redis shard → feed service fallback to DB, latency tăng nhưng < 1s
2. Kafka broker restart → fan-out service reconnect, consumer lag < 30s
3. DB primary failover to replica → write path recovers within 30s (RDS Multi-AZ)

## 12. 🔒 Security

| Category | Implementation |
|---|---|
| **Authentication** | JWT (RS256) cho tất cả API calls. OAuth2 + OpenID Connect cho social login. Refresh token rotation. |
| **Authorization** | Owner-based: chỉ post owner mới sửa/xóa post. Visibility-based: private posts chỉ hiện cho owner. RBAC cho admin operations (suspend user, content moderation). |
| **TLS** | HTTPS (TLS 1.3) cho tất cả public endpoints. Internal mTLS giữa services (nếu dùng Istio service mesh). |
| **Input Validation** | Post content: max 5000 chars, strip HTML tags (XSS prevention). Username: alphanumeric + underscore, 3-30 chars. Media: validate MIME type trước presigned URL. |
| **DDoS / Bot Protection** | AWS WAF: rate-based rules (1000 req/5min per IP), managed rule groups (bot control). AWS Shield Standard (free). |
| **Data Protection** | Encryption at rest: RDS (AES-256 via KMS), S3 (SSE-S3), ElastiCache (at-rest encryption). Encryption in transit: TLS everywhere. |
| **Secrets Management** | AWS Secrets Manager cho DB credentials, API keys. Kubernetes Secrets (encrypted via KMS) cho service-to-service tokens. |
| **Content Moderation** | Text filter: regex-based banned words filter (sync). Image moderation: AWS Rekognition (async, flag inappropriate content). |
| **OWASP Top 10** | SQL Injection: parameterized queries (Spring Data JPA). XSS: sanitize user content on output. CSRF: SameSite cookies + CORS config. Broken Auth: JWT expiry, refresh rotation, account lockout after 5 failed attempts. |

**Rate Limiting cho abuse prevention:**
- Tạo post: 10/hour per user → chống spam post
- Like: 120/min → chống bot like
- Follow: 50/hour → chống follow spam
- Comment: 30/min → chống comment spam
- Nếu exceed persistent: temporary ban 1 hour → escalate to permanent review

## 13. 📊 Monitoring & Logging

### Key Metrics

| Nhóm | Metrics |
|---|---|
| **Latency** | Feed fetch p50/p95/p99, post creation p50/p95/p99, fan-out end-to-end latency, Redis command latency, DB query latency |
| **Traffic** | Feed read RPS, post write RPS, fan-out writes/s, WebSocket connections, API Gateway RPS by endpoint |
| **Errors** | HTTP 4xx/5xx rate by service, Kafka consumer error rate, Redis connection errors, DB connection pool exhaustion |
| **Saturation** | CPU/memory per pod, Redis memory utilization per shard, DB connection pool usage, Kafka consumer lag, disk I/O |

### Logging Strategy
- **Format**: Structured JSON logs
- **Fields**: `timestamp`, `level`, `service`, `traceId`, `spanId`, `userId`, `requestId`, `method`, `path`, `status`, `latencyMs`, `message`
- **Log levels**:
  - `INFO`: request/response summaries, business events (post created, user followed)
  - `WARN`: rate limit triggered, cache miss rate > threshold, slow queries > 200ms
  - `ERROR`: unhandled exceptions, downstream service failures, data inconsistency detected
- **Centralized logging**: OpenSearch (AWS managed) — retention 30 days hot, 90 days warm, 1 year cold (S3)
- **Log sampling**: production INFO logs sampled 10% (trừ errors/warnings — always log)

### SLI / SLO / Error Budget (SRE)

| SLI | SLO | Error Budget |
|---|---|---|
| Feed fetch success rate (non-5xx) | ≥ 99.95% | 0.05% ≈ 21.6 min downtime/month |
| Feed fetch latency p99 | < 500ms | Breaches > 500ms count against budget |
| Post creation success rate | ≥ 99.9% | 0.1% ≈ 43.2 min/month |
| Fan-out end-to-end delay | < 5 seconds (p99) | Posts appearing in feed within 5s |

**Error Budget Policy:**
- Budget > 50%: normal development velocity, deploy daily
- Budget 20-50%: reduce deployment frequency, focus stability
- Budget < 20%: freeze feature deployments, prioritize reliability fixes
- Budget exhausted: incident review, mandatory architecture improvements before resume

### Alerting & Incident Response

| Alert | Condition | Severity | Action |
|---|---|---|---|
| Feed latency high | p95 > 200ms for 5 min | P2 | Check Redis latency, DB connection pool, pod CPU |
| Feed error rate spike | 5xx rate > 1% for 3 min | P1 | Page on-call, check service health, recent deployments |
| Fan-out consumer lag | Lag > 100K messages for 10 min | P2 | Scale up fan-out workers, check Redis write throughput |
| Redis memory high | > 85% on any shard | P3 | Add shard or increase instance size within 24h |
| DB connections exhausted | Pool usage > 90% for 5 min | P1 | Check for slow queries, connection leaks |
| Kafka broker unhealthy | ISR shrink on any topic | P2 | Check broker health, disk space |

**Distributed tracing**: OpenTelemetry SDK → Jaeger/X-Ray backend. Trace feed fetch: Client → Gateway → Feed Service → Redis → (DB fallback) → Ranking → Response. Sampling: 1% production, 100% on error.

## 14. 🔧 Maintenance

| Category | Tool/Strategy | Chi tiết |
|---|---|---|
| **CI/CD Pipeline** | GitHub Actions | Stages: `lint → unit test → build → integration test → security scan (Trivy, Snyk) → push Docker image → deploy staging → smoke test → deploy prod (canary)` |
| **DB Migration** | Flyway | Backward-compatible migrations only (add column, add table). Drop column → 2-phase: stop reading → deploy → drop. Migration tested on staging clone trước. |
| **Dependency Management** | Renovate | Auto-create PRs cho dependency updates. Security patches: auto-merge. Major versions: manual review. |
| **Feature Flags** | LaunchDarkly / Unleash | Use cases: new ranking algorithm rollout (% users), celebrity threshold tuning, new feed UI A/B test |
| **Documentation** | OpenAPI 3.0 (Springdoc) | Auto-generate từ controllers, publish lên internal docs portal. ADR (Architecture Decision Records) cho mỗi significant decision. |
| **Technical Debt** | Sprint allocation | 15% sprint capacity cho tech debt. Quarterly tech debt review meeting. Track via JIRA epic "Tech Debt". |

**Feed cache maintenance:**
- Weekly job: cleanup orphan feed entries (post đã deleted nhưng vẫn trong feed cache)
- Daily job: refresh celebrity_set (recompute từ DB — users với follower_count >= 10K)
- Monthly job: archive old posts partitions (> 1 year) sang read-only partition

## 15. 🚀 Deployment Plans

### Deployment Strategy

| Service | Strategy | Chi tiết |
|---|---|---|
| Feed Service | **Canary** (5% → 25% → 50% → 100%) | Critical path, gradual rollout với latency/error monitoring |
| Post Service | **Canary** (10% → 50% → 100%) | Write path, monitor error rate at each stage |
| Fan-out Workers | **Rolling update** | Stateless Kafka consumers, K8s rolling update suffices |
| API Gateway | **Blue-Green** | Zero-downtime switch, instant rollback |
| Other services | **Rolling update** | Standard K8s rolling update |

### Rollback Plan
- **Application**: `kubectl rollout undo deployment/<service-name>` — instant rollback to previous revision
- **DB migration**: Flyway backward-compatible only → no rollback needed. Nếu cần: deploy new migration that reverses changes.
- **Feature flag**: Kill-switch — disable feature instantly via LaunchDarkly/Unleash dashboard
- **Cache**: Force rebuild — `DELETE feed:{userId}` + next request triggers rebuild. Mass rebuild via Kafka event.
- **Automated rollback**: Canary auto-rollback nếu error rate > 1% hoặc p95 latency > 2× baseline trong 5 min.

### Infrastructure as Code (Terraform)

```
terraform/
├── modules/
│   ├── vpc/              # VPC, subnets, NAT Gateway, security groups
│   ├── eks/              # EKS cluster, node groups, IRSA
│   ├── rds/              # PostgreSQL Multi-AZ, parameter groups, replicas
│   ├── elasticache/      # Redis cluster, parameter groups, subnet groups
│   ├── msk/              # Kafka cluster, topics, security config
│   ├── s3/               # Media bucket, lifecycle policies
│   ├── cloudfront/       # CDN distribution, origins, behaviors
│   ├── route53/          # DNS records, health checks
│   ├── waf/              # WAF rules, rate limiting
│   ├── iam/              # Service roles, policies
│   └── monitoring/       # CloudWatch alarms, dashboards
├── environments/
│   ├── dev/
│   ├── staging/
│   └── prod/
├── backend.tf            # S3 + DynamoDB state backend
└── versions.tf
```

### Auto-scaling

| Resource | Type | Trigger | Thresholds |
|---|---|---|---|
| EKS node group | Cluster Autoscaler | Pending pods | Min 6 nodes, Max 30 nodes |
| Feed Service pods | HPA | Custom metric (RPS) | Min 8, Max 40, target 1200 RPS/pod `[C2]` |
| Fan-out Worker pods | HPA | Kafka consumer lag | Min 10, Max 50, target lag < 10K `[C3]` |
| Post Service pods | HPA | CPU | Min 3, Max 10, target 70% |
| Redis Cluster | Manual (planned) | Memory > 80% | Add shard, rebalance |
| RDS | Manual (planned) | CPU > 70% sustained | Scale up instance class |

### Multi-region (Phase 2)
- **Active-Passive**: Primary region `ap-southeast-1`, DR region `ap-northeast-1`
- Route53 health check → automatic failover nếu primary unhealthy
- RDS cross-region read replica cho DR
- Redis: không replicate cross-region (rebuild feed cache on failover)
- S3: Cross-Region Replication cho media
- Kafka: MirrorMaker 2 cho critical topics

### Pre-prod Gate
Trước khi deploy production:
1. ✅ All unit + integration tests pass
2. ✅ Security scan (Trivy container + Snyk dependencies) — no critical/high vulnerabilities
3. ✅ Load test trên staging: sustain peak QPS 10 min, p95 < 200ms
4. ✅ Smoke test trên staging: create post → appears in feed < 10s
5. ✅ DB migration tested trên staging clone
6. ✅ Canary bake time: 15 min at 5% traffic, no anomaly

## 16. ⏱️ Effort Estimation

### Phase Breakdown & Timeline

| Phase | Duration | Deliverables |
|---|---|---|
| **Phase 0: Discovery** | 2 tuần | Requirements finalized, tech stack confirmed, architecture design reviewed, ADR documented |
| **Phase 1: MVP** | 8 tuần | Core features: create post (text only), follow/unfollow, chronological feed (fan-out on write only, no celebrity handling), basic API + React UI |
| **Phase 2: Feed Enhancement** | 6 tuần | Hybrid fan-out (celebrity handling), score-based ranking, infinite scroll, like/comment, media upload (S3 + CDN) |
| **Phase 3: Real-time & Scale** | 4 tuần | WebSocket feed updates, notification service, Redis cluster scaling, load testing + performance tuning |
| **Phase 4: Hardening** | 4 tuần | Security hardening (WAF, rate limiting, content moderation), chaos engineering, monitoring/alerting setup, documentation |
| **Phase 5: Production Readiness** | 2 tuần | Canary deployment pipeline, runbooks, on-call rotation setup, final load test, go-live checklist |
| **Total** | **26 tuần (~6.5 tháng)** | Production-ready News Feed system |

### Team Composition

| Role | Số lượng | Responsibilities |
|---|---|---|
| Tech Lead / Architect | 1 | Architecture decisions, code review, cross-team coordination |
| Backend Engineer (Senior) | 2 | Post Service, Feed Service, Fan-out Service, Ranking Engine |
| Backend Engineer (Mid) | 2 | Social Graph Service, Engagement Service, Notification Service |
| Frontend Engineer | 2 | React SPA: feed UI, post creation, infinite scroll, real-time updates |
| DevOps / SRE | 1 | Terraform, CI/CD, K8s, monitoring, scaling |
| QA Engineer | 1 | Test strategy, automation, load testing, chaos engineering |
| **Total** | **9 người** | |

### Risk Assessment

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Fan-out latency too high at scale | 🔴 High — stale feed | Medium | Kafka partitioning, horizontal scaling Fan-out Workers, batch Redis pipeline `[C3]` |
| Redis cluster memory exhaustion | 🔴 High — feed unavailable | Medium | Monitoring + alert at 80%, aggressive TTL, trim feed cache to 500 entries |
| Celebrity user growth (more users cross 10K threshold) | 🟡 Medium — more pull-on-read overhead | Medium | Auto-detect via daily cron job, adjustable threshold via feature flag |
| PostgreSQL write bottleneck | 🟡 Medium — post creation degraded | Low | Connection pooling, partitioning, sharding plan ready |
| Ranking algorithm quality low | 🟡 Medium — poor engagement | Medium | A/B testing framework, feature flag rollout, iterate ranking weights |

### Dependencies & Blockers

| Dependency | Owner | Impact nếu delay |
|---|---|---|
| AWS account + IAM setup | Platform Team | Block all infrastructure provisioning |
| Domain + SSL certificate | DevOps | Block public-facing deployment |
| Push notification credentials (FCM/APNs) | Mobile Team | Block notification feature |
| Content moderation policy | Legal/Trust & Safety | Block content filter implementation |
| Load testing environment | DevOps | Block performance validation |

## 17. 💰 Cost Estimation & Optimization

### 17.1 Chi phí hàng tháng theo từng resource

**Region: `ap-southeast-1` (Singapore), AWS On-Demand pricing**

**Compute (EKS):**

| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| EKS Cluster | Control plane | 1 | $73 | $73 | Managed K8s |
| Worker nodes (Feed Service) | m6i.2xlarge (8 vCPU, 32GB) | 10 | $280 | $2,800 | 8-40 pods `[C2]`, avg 10 nodes |
| Worker nodes (Fan-out + Others) | m6i.xlarge (4 vCPU, 16GB) | 8 | $140 | $1,120 | Fan-out workers `[C3]` + other services |
| **Subtotal Compute** | | | | **$3,993** | |

**Database (RDS PostgreSQL):**

| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| Primary | r6g.2xlarge (8 vCPU, 64GB) Multi-AZ | 1 | $1,200 | $1,200 | Write path `[C1]` |
| Read Replica | r6g.xlarge (4 vCPU, 32GB) | 2 | $430 | $860 | Feed fallback + analytics |
| Storage (gp3) | 5TB initial | 1 | $400 | $400 | `[C4]` ~27.4TB/year, start 5TB |
| **Subtotal Database** | | | | **$2,460** | |

**Cache (ElastiCache Redis):**

| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| Redis Cluster shards | r6g.2xlarge (52GB) | 20 shards | $520 | $10,400 | ~1TB total `[C6]` — feed + post + social cache |
| **Subtotal Cache** | | | | **$10,400** | |

> 📌 Redis là chi phí lớn nhất (~45% total). Optimization: chỉ cache feed cho active users (giảm shard count), aggressive TTL, instance right-sizing.

**Message Queue (MSK - Kafka):**

| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| MSK Cluster | kafka.m5.2xlarge, 3 brokers | 1 | $1,800 | $1,800 | 32 partitions `[C3]` |
| Storage (1TB per broker) | gp3 | 3 | $80 | $240 | Retention 7 days |
| **Subtotal MQ** | | | | **$2,040** | |

**Network / CDN:**

| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| ALB | 1 ALB | 1 | $22 + LCU | $200 | ~46K peak RPS `[C2]` |
| CloudFront | 50TB transfer/month | 1 | $0.085/GB | $4,250 | Media delivery `[C5]` |
| NAT Gateway | 2 AZ | 2 | $32 + data | $200 | Outbound internet |
| Route53 | Hosted zone + queries | 1 | $0.50 + queries | $50 | DNS |
| **Subtotal Network** | | | | **$4,700** | |

**Storage (S3):**

| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| S3 Standard | ~230TB (first year growth) | 1 | $0.023/GB | $5,290 | Media storage `[C5]` (avg over year) |
| S3 requests | PUT/GET | — | — | $500 | 15M uploads/day |
| **Subtotal Storage** | | | | **$5,790** | |

**Monitoring / Logging:**

| Resource | Spec / Sizing | Số lượng | Đơn giá (USD/tháng) | Thành tiền (USD/tháng) | Ghi chú |
|---|---|---|---|---|---|
| CloudWatch | Metrics + logs | 1 | — | $300 | Custom metrics, log ingestion |
| OpenSearch (Logging) | m6g.xlarge.search, 3 nodes | 1 | $400 | $1,200 | 30-day hot retention |
| Prometheus + Grafana | Self-hosted on EKS | 1 | — | $0 | Included in compute cost |
| **Subtotal Monitoring** | | | | **$1,500** | |

### 17.2 Tổng hợp cost theo giai đoạn

| Giai đoạn | Monthly Cost | Annual Cost | Ghi chú |
|---|---|---|---|
| **MVP** (10M DAU, minimal cache) | ~$8,000 | ~$96,000 | 5 Redis shards, 1 DB, 4 worker nodes, minimal CDN |
| **Growth** (50M DAU, avg traffic) | ~$18,000 | ~$216,000 | 10 Redis shards, 2 replicas, 8 worker nodes |
| **Peak/Scale** (100M DAU, full traffic) | ~$30,883 | ~$370,596 | 20 Redis shards, full cluster, CDN heavy usage |

### 17.3 Cost Breakdown theo category

| Category | Monthly Cost (Peak) | % Tổng Cost |
|---|---|---|
| Cache (Redis) | $10,400 | **33.7%** |
| Storage (S3) | $5,790 | 18.8% |
| Network/CDN | $4,700 | 15.2% |
| Compute (EKS) | $3,993 | 12.9% |
| Database (RDS) | $2,460 | 8.0% |
| Message Queue (MSK) | $2,040 | 6.6% |
| Monitoring | $1,500 | 4.9% |
| **Total** | **$30,883** | **100%** |

> 📌 **Redis chiếm ~34% tổng cost** — đây là chi phí lớn nhất do feed cache cho 100M users. Đây là trade-off có ý thức: Redis cache giúp feed latency < 200ms `[C2]`, nếu bỏ Redis thì feed latency tăng 5-10× và DB cost tăng (cần nhiều read replicas hơn).

### 17.4 Cost Optimization Strategies

| Strategy | Mô tả | Tiết kiệm ước tính | Trade-off |
|---|---|---|---|
| **Reserved Instances (1-year)** | RI cho RDS, ElastiCache, MSK — workload ổn định | ~35% compute/DB ≈ $5,500/tháng | Commit 1 năm, kém flexible |
| **Savings Plans (3-year)** | EC2 Savings Plans cho EKS worker nodes | ~40% compute ≈ $1,600/tháng | Commit 3 năm |
| **Redis right-sizing** | Chỉ cache active users (DAU), TTL aggressive 3 days thay 7 | ~30% Redis ≈ $3,120/tháng | Cold users có higher feed latency |
| **S3 Intelligent-Tiering** | Auto-tier media dựa trên access pattern | ~20% S3 ≈ $1,160/tháng | Retrieval latency cho cold data |
| **CloudFront caching optimization** | Tăng cache TTL cho media, cache hit ratio > 98% | ~15% CDN ≈ $640/tháng | Stale media cho vài giờ sau update |
| **Spot Instances cho Fan-out Workers** | Fan-out workers stateless, tolerant to interruption | ~60% worker cost ≈ $670/tháng | Occasional interruption, Kafka rebalance |
| **Log sampling** | Sample INFO logs 10%, keep 100% ERROR/WARN | ~40% logging ≈ $480/tháng | Harder to debug non-error issues |

**Tổng tiết kiệm tiềm năng**: ~$13,170/tháng (43% total) → effective cost ~$17,700/tháng

### 17.5 Cost Projection (12 tháng)

Giả sử DAU tăng 15% mỗi quý:

| Tháng | DAU Estimate | Infra Changes | Monthly Cost |
|---|---|---|---|
| Month 1-3 | 100M | Baseline setup | $30,883 |
| Month 4-6 | 115M | +3 Redis shards, +2 EKS nodes | $35,500 |
| Month 7-9 | 132M | +5 Redis shards, scale up DB to r6g.4xlarge, +50TB S3 | $42,000 |
| Month 10-12 | 152M | +5 Redis shards, add 3rd read replica, consider DB sharding | $50,000 |

**Inflection points:**
- **Month 6**: Redis cluster > 1.2TB → cần add shards hoặc review cache strategy
- **Month 9**: DB primary CPU > 70% sustained → scale up instance class
- **Month 12**: Single PostgreSQL approaching limits → evaluate Citus/Vitess sharding
- **Month 12**: S3 storage > 3PB → review lifecycle policies, Glacier Deep Archive cho old media

### 17.6 Cost Alerts & Governance

| Alert | Threshold | Action |
|---|---|---|
| Monthly cost > 80% budget | $24,700 (80% of $30,883) | Email notification to team lead |
| Monthly cost > 100% budget | $30,883 | Slack alert to engineering + finance |
| Monthly cost > 120% budget | $37,060 | Page VP Engineering, immediate cost review |
| Any single service > 150% forecast | Variable | Investigate anomaly, check for misconfiguration |

**Cost review process:**
- **Monthly**: Engineering lead reviews cost dashboard, compare actual vs forecast
- **Quarterly**: Cost optimization sprint — identify right-sizing opportunities, review RI coverage
- **Annually**: Re-negotiate Reserved Instances, evaluate alternative architectures

**Tagging strategy:**
```
aws:tag:Environment = prod | staging | dev
aws:tag:Service = feed-service | post-service | fanout-service | ...
aws:tag:Team = newsfeed-team
aws:tag:CostCenter = engineering-platform
aws:tag:ManagedBy = terraform
```

> 📌 Tagging cho phép phân bổ cost chính xác theo service — giúp identify service nào tốn kém nhất và optimize targeted.
