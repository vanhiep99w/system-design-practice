# AGENTS.md — Hướng Dẫn Cho AI Agent

## 📋 Tổng Quan Dự Án

Đây là repository chứa các bài thực hành **System Design** cho các hệ thống thực tế. Mỗi file markdown ở **root folder** là một bài thiết kế hoàn chỉnh theo chuẩn **System Design Blueprint** gồm 16 bước.

## 🛠️ Tech Stack Ưu Tiên

Khi thiết kế hệ thống, **ưu tiên sử dụng** tech stack dưới đây. Tuy nhiên, nếu có giải pháp tốt hơn cho bài toán cụ thể, vẫn được phép sử dụng — nhưng **phải giải thích lý do** tại sao không dùng stack mặc định.

### Stack mặc định

| Layer | Technology | Ghi chú |
|-------|-----------|---------|
| **Frontend** | React (TypeScript) | SPA, hooks, state management (Redux/Zustand) |
| **Backend** | Java 17+ / Spring Boot 3.x | REST API, Spring Security, Spring Data |
| **Database** | PostgreSQL (chính), Redis (cache) | Tùy bài có thể thêm MongoDB, Elasticsearch |
| **Message Queue** | Apache Kafka | Event-driven architecture |
| **Cloud Provider** | AWS | EC2, ECS/EKS, RDS, S3, SQS, SNS, CloudFront, Route53, ElastiCache... |
| **Container Orchestration** | Kubernetes (K8s) | EKS trên AWS |
| **IaC** | Terraform | Quản lý infrastructure as code |
| **CI/CD** | GitHub Actions / Jenkins | Build, test, deploy pipeline |
| **Monitoring** | CloudWatch, Prometheus, Grafana | Metrics, alerting, dashboards |
| **Logging** | ELK Stack (Elasticsearch, Logstash, Kibana) | Centralized logging |

### Quy tắc sử dụng tech stack

1. **Mặc định**: Luôn thiết kế với stack trên trước
2. **Thay thế khi cần**: Nếu có lựa chọn tốt hơn (ví dụ: Cassandra cho write-heavy workload, gRPC cho inter-service communication), giải thích rõ trong section **Trade-offs**
3. **Code examples**: Viết code ví dụ bằng **Java/Spring Boot** (backend) và **React** (frontend)
4. **Infrastructure**: Mô tả deployment trên **AWS + K8s + Terraform**
5. **Khi dùng stack khác**: Thêm callout block giải thích:
   ```markdown
   > 💡 **Tại sao không dùng [default tech]?**
   > [Giải thích lý do chọn alternative và ưu điểm so với default]
   ```

## 🏗️ Cấu Trúc Thư Mục

```
system-design-practice/
├── README.md                    # Giới thiệu tổng quan repo
├── AGENTS.md                    # File hướng dẫn cho AI agent (file này)
├── url-shortener.md             # Thiết kế URL Shortener
├── chat-system.md               # Thiết kế Chat System
├── ...                          # Các bài thiết kế khác
└── payment-system.md            # Thiết kế Payment System
```

> 💡 Tất cả diagrams sử dụng **Mermaid** hoặc **ASCII art** trực tiếp trong file markdown, không cần thư mục riêng.

## 📐 Template Bài Thiết Kế

Khi tạo mới hoặc chỉnh sửa bài thiết kế, **BẮT BUỘC** tuân theo template dưới đây. Mỗi section tương ứng với một bước trong System Design Blueprint.

> ⚠️ Template dưới đây mô tả **cấu trúc + hướng dẫn methodology chi tiết**. Khi viết bài thực tế, thay các hướng dẫn bằng nội dung cụ thể cho hệ thống đang thiết kế.

```markdown
# [Tên Hệ Thống] - System Design

## 1. 📋 Đề Bài (Problem Statement)
- Mô tả ngắn gọn hệ thống cần thiết kế và bối cảnh thực tế
- **Scope chính** (in scope): liệt kê rõ các chức năng nằm trong phạm vi
- **Scope ngoài bài** (out of scope): liệt kê rõ những gì KHÔNG thiết kế để tránh scope creep
- **Mục tiêu business**: tại sao hệ thống này cần tồn tại, giá trị mang lại

## 2. 🔍 Requirement Gathering & Analysis

### 2.1 Functional Requirements
- Dùng **bảng** với 3 cột: `Priority | Requirement | Mô tả`
- Priority: phân loại rõ `MUST-HAVE` vs `NICE-TO-HAVE`
- Mỗi requirement phải mô tả rõ user interaction cụ thể, không chung chung

### 2.2 Non-Functional Requirements
- **Performance**: Chỉ rõ latency targets theo percentile (p95, p99), tách biệt cho từng loại operation
- **Scalability**: Số concurrent users, peak QPS, data growth rate
- **Availability**: SLA cụ thể (99.9%, 99.99%), có thể khác nhau cho từng path (ví dụ: read path vs write path)
- **Consistency**: Chỉ rõ strong vs eventual cho từng loại data, kèm acceptable delay
- **Security**: Authentication method, encryption requirements, abuse protection
- **Observability**: Golden Signals (latency, error, traffic, saturation), tracing strategy

### 2.3 Capacity Estimation (Back-of-the-envelope)

> 📌 **Methodology bắt buộc**: Tính step-by-step, mỗi bước có **công thức → thay số → kết quả**. KHÔNG đưa con số không có nguồn gốc.

#### Bước 0: Quy ước đơn vị
- Khai báo rõ quy ước: `1 day = 86,400s`, `1M = 1,000,000`, `1B = 1,000,000,000`
- Thống nhất dùng đơn vị thập phân hay nhị phân

#### Bước 1: Inputs giả định
- Dùng bảng `Input | Giá trị | Tại sao chọn` — mỗi input phải có **justification**
- Ví dụ inputs: DAU, actions per user per day, avg payload size, metadata size

#### Bước 2-N: Tính toán từng metric
- Mỗi metric là 1 bước riêng: Write QPS, Read QPS, Storage, Bandwidth, Cache memory
- Format mỗi bước:
  1. Công thức chữ
  2. Thay số cụ thể
  3. Kết quả (bold)
  4. Peak factor (thường x3-x5) kèm kết quả peak

#### Bước cuối: So sánh kịch bản
- Bảng so sánh ít nhất 2 kịch bản (Base vs Conservative) để cross-check tính hợp lý
- Dùng callout `> 📌` để ghi chú các giả định quan trọng

## 3. ⚖️ Trade-offs

### 3.1 Bảng tổng quan quyết định
- Bảng summary tất cả decisions: `Decision | Option A | Option B | Chọn | Lý do chính`
- Bold option được chọn

### 3.2+ Deep-dive từng Decision
Mỗi decision quan trọng cần 1 sub-section riêng với cấu trúc:
1. **Bảng so sánh tiêu chí**: `Tiêu chí | Option A | Option B`
2. **"Hoạt động thế nào?"** cho mỗi option: mô tả step-by-step flow
3. **Ví dụ với số thật**: walk-through end-to-end với data thực tế, không abstract
4. **Pseudo-code so sánh**: code ngắn gọn cho mỗi option để thấy độ phức tạp
5. **Kết luận**: context bài toán → chọn gì → lý do → mitigation cho nhược điểm
6. **Callout `> 💡`** giải thích nếu dùng stack khác default

## 4. 🧩 Defining Entities / Components
- **Component diagram** bắt buộc (mermaid flowchart/graph)
- Sử dụng `subgraph` để nhóm theo layer (Edge, Application, Data, Async, Observability)
- Kèm **bảng** mô tả vai trò từng component: `Component | Vai trò`
- Các thành phần điển hình: Client, CDN/WAF, API Gateway, Services, Database, Cache, Message Queue, Observability stack

## 5. 🔗 Client-Server Connection
- **Protocol**: chỉ rõ từng loại connection (REST cho management, redirect cho read, WebSocket cho real-time...)
- **Authentication**: method cụ thể (JWT, OAuth2, API Key), phân biệt endpoint nào cần auth
- **Connection patterns**: Request-Response, Pub-Sub, Streaming — chỉ rõ dùng ở đâu
- **Rate limiting & throttling**: chỉ rõ limit theo role (anonymous, authenticated, plan-based), thuật toán (token bucket, sliding window)
- **Idempotency**: strategy cho các write operations (Idempotency-Key header, dedup logic)

## 6. 🔄 System / App Flow

### Flow 1: [Core use case chính - ví dụ: Create]
- **Mermaid sequence diagram** bắt buộc
- Bao gồm tất cả participants: Client, Gateway, Services, DB, Cache, Queue
- Thể hiện rõ `alt/else` cho branching logic (ví dụ: custom alias vs auto-generated)

### Flow 2: [Core use case thứ hai - ví dụ: Read/Query]
- **Mermaid sequence diagram** bắt buộc
- Thể hiện cache hit/miss logic
- Thể hiện async operations (ví dụ: publish event to Kafka)

### Error handling & Edge cases
- Liệt kê từng error case cụ thể kèm HTTP status code và behavior
- Ví dụ: not found → 404, expired → 410 Gone, conflict → 409, malformed → 400
- Mô tả fallback behavior khi dependency lỗi (ví dụ: Redis down → fallback DB)

## 7. 📡 API Modeling

### Endpoint Definitions
- Dùng **bảng**: `Method | Path | Auth | Mô tả`
- Chỉ rõ auth requirement cho từng endpoint

### Request/Response Examples
- Viết **full HTTP request** bao gồm headers (Content-Type, Authorization, Idempotency-Key)
- Viết **full JSON response** với data thực tế, không dùng placeholder `...`
- Bao gồm cả redirect response (nếu có) với status code và headers

### Error Response Format
- Định nghĩa error schema chuẩn: `timestamp, status, error, code, message, path`
- Ví dụ error response thực tế

### Pagination / Filtering / Sorting
- Chỉ rõ strategy: cursor-based vs offset-based (và lý do)
- Liệt kê filter/sort fields hỗ trợ

### API Versioning
- Strategy: path-based (`/api/v1`) vs header-based
- Deprecation policy: dual-run period bao lâu

## 8. 🗄️ Data Modeling

### Database Schema
- Viết **full SQL DDL** (CREATE TABLE) với:
  - Data types cụ thể
  - Constraints (PRIMARY KEY, UNIQUE, NOT NULL, CHECK)
  - Default values
- Mỗi bảng có schema riêng, không gộp

### ER Diagram
- **Mermaid erDiagram** bắt buộc
- Thể hiện rõ relationship cardinality (1-1, 1-N, N-N)
- Liệt kê columns với data type và PK/FK/UK markers

### Indexing Strategy
- Liệt kê từng index: tên, columns, loại (unique, partial, composite)
- Giải thích mỗi index phục vụ query pattern nào

### Partitioning / Sharding Strategy
- Chỉ rõ partition key và strategy cho từng bảng (hash, range, list)
- Mô tả khi nào cần shard (threshold) và routing strategy (application-level hay proxy)

### Data Retention Policy
- Chỉ rõ retention period cho từng loại data
- Mô tả rollup/archival strategy (ví dụ: detail → monthly rollup → Glacier)

### Callout giải thích design decisions
- Dùng `> 💡` để giải thích tại sao chọn cách lưu trữ nhất định

## 9. ⚙️ Manager Classes / Services

### Service Decomposition
- Liệt kê tất cả microservices với mô tả ngắn vai trò

### Core Service Classes & Responsibilities
- Liệt kê class chính với annotation Spring (`@Service`, `@Component`, `@Configuration`, `@Aspect`)
- Mô tả responsibility cụ thể cho từng class

### Backend Code Example (Java / Spring Boot)
- Viết **code thực tế** cho core service class (không pseudo-code)
- Bao gồm: annotations, constructor injection, business logic method
- Code phải thể hiện rõ design decisions đã chọn ở section 3

### Frontend Code Example (React + TypeScript)
- Viết **component thực tế** cho core user interaction
- Bao gồm: hooks, API call, basic UI rendering
- Sử dụng functional component + TypeScript

### Service Communication Patterns
- Chỉ rõ sync vs async cho từng pair of services
- Liệt kê shared libraries/modules

## 10. 🏛️ Architecture Design
- Pattern chính và lý do chọn (Microservices, Monolith, Serverless...)
- Mô tả tối ưu hóa cho critical path (ví dụ: read path vs write path)

### Architecture Diagram
- **Mermaid flowchart** bắt buộc, chi tiết với:
  - `subgraph` cho từng layer: Internet, AWS_Edge, AWS_VPC, EKS
  - Tên AWS services cụ thể (Route53, CloudFront, ALB, EKS, RDS, ElastiCache, MSK, S3...)
  - Đường kết nối rõ ràng giữa components
  - Đường metrics/logs dùng dotted line (`-.->`)

### Scaling Strategy
- HPA/VPA: trigger metric cụ thể cho từng service
- Database scaling: scale-up, read replicas, connection pooling
- Cache scaling: shard rebalancing, memory thresholds

### Caching Strategy
- Mô tả **multi-layer caching**: CDN (L1) → Application cache (L2) → DB
- Eviction policy cụ thể (LRU, LFU, TTL)
- Cache invalidation strategy

### Load Balancing / Gateway / Service Mesh
- Loại LB (ALB/NLB) và routing rules
- Gateway capabilities (auth, rate-limit, routing)
- Service mesh (optional): mTLS, traffic policy

## 11. 🧪 Testing Strategy
- **Unit Testing**: framework + coverage target + scope (ví dụ: service logic)
- **Integration Testing**: framework + external dependencies (Testcontainers cho DB, Redis, Kafka)
- **API Contract Testing**: giữa services (Spring Cloud Contract)
- **Load Testing**: tool + kịch bản cụ thể (peak QPS target, latency assertion)
- **Chaos Engineering**: tool + failure scenarios cụ thể (node failure, AZ outage, cache down)
- **E2E Testing**: tool + critical user flows được test

## 12. 🔒 Security
- **Authentication**: method cụ thể, phân biệt endpoint nào cần auth
- **Authorization**: model (RBAC, owner-based, policy-based)
- **TLS**: public HTTPS + internal mTLS (nếu service mesh)
- **Input validation**: chống SSRF, injection, schema validation
- **DDoS/bot protection**: WAF rules, Shield tier
- **Data protection**: encryption at rest (KMS), encryption in transit
- **OWASP Top 10**: liệt kê mitigation cụ thể cho relevant items
- **Compliance**: GDPR, data residency nếu applicable

## 13. 📊 Monitoring & Logging

### Key Metrics
- Dùng **bảng** `Nhóm | Metrics` theo Golden Signals:
  - Latency: p50/p95/p99 cho từng operation
  - Traffic: RPS, connections
  - Errors: 4xx/5xx rate, timeout rate, cache miss ratio
  - Saturation: CPU, memory, DB connections, queue depth

### Logging Strategy
- Structured JSON logs với correlation fields (traceId, userId, requestId)
- Log levels: khi nào INFO/WARN/ERROR
- Centralized logging: ELK/OpenSearch, retention policy

### Alerting & Incident Response
- Alert conditions cụ thể với **thresholds + time window** (ví dụ: `p95 > 100ms trong 5 phút`)
- Runbook outline: detect → triage → mitigate → postmortem
- Distributed tracing: OpenTelemetry + backend (Jaeger/X-Ray)

## 14. 🔧 Maintenance
- **CI/CD pipeline**: stages cụ thể (`build → test → security scan → deploy`)
- **Database migration**: tool (Flyway/Liquibase), backward-compatible strategy
- **Dependency management**: auto-update tool (Renovate/Dependabot), SCA scanning
- **Feature flags**: tool + use cases cụ thể
- **Documentation**: OpenAPI/Swagger auto-publish, ADR (Architecture Decision Records)
- **Technical debt**: review cadence + capacity allocation (ví dụ: 10-15%/sprint)

## 15. 🚀 Deployment Plans
- **Deployment strategy**: Canary (% rollout stages) / Blue-Green / Rolling — chỉ rõ cho từng service
- **Rollback plan**: `kubectl rollout undo`, DB migration rollback, feature flag kill-switch
- **IaC**: Terraform modules cho từng resource (VPC, EKS, RDS, ElastiCache, MSK, S3, IAM)
- **Auto-scaling**: HPA/VPA + Cluster Autoscaler + ASG thresholds
- **Multi-region**: active-active vs active-passive, failover mechanism (Route53 health check)
- **Artifacts**: Docker multi-stage build, Helm charts cho từng service
- **Pre-prod gate**: required checks trước production (load test, smoke test, security scan)

## 16. ⏱️ Effort Estimation

### Phase Breakdown & Timeline
- Dùng **bảng** `Phase | Duration | Deliverables`
- Chia phase rõ ràng: Discovery → MVP → Features → Hardening → Production Readiness

### Team Composition
- Liệt kê roles + số lượng + responsibilities chính

### Risk Assessment
- Dùng **bảng** `Risk | Impact | Mitigation`
- Ít nhất 3-5 risks cụ thể cho hệ thống đang thiết kế

### Dependencies & Blockers
- Liệt kê external dependencies (platform team, security review, budget approval...)
```

## 📝 Quy Tắc Viết Nội Dung

### Ngôn ngữ
- **Tiêu đề section**: Tiếng Việt (kèm emoji)
- **Nội dung kỹ thuật**: Kết hợp Tiếng Việt + thuật ngữ tiếng Anh gốc
- **Code/API/Schema**: Tiếng Anh

### Định dạng
- Sử dụng **Mermaid diagrams** cho tất cả sơ đồ (architecture, sequence, ER, flowchart)
- Sử dụng **bảng** (tables) cho so sánh, capacity estimation
- Sử dụng **code blocks** cho API definitions, schema, config
- Sử dụng **callout blocks** (> ⚠️, > 💡, > 📌) cho notes quan trọng

### Độ chi tiết
- Mỗi section phải có **ít nhất 3-5 bullet points** giải thích
- Capacity estimation phải có **con số cụ thể** kèm phép tính
- API modeling phải có **ví dụ request/response** thực tế
- Data modeling phải có **schema chi tiết** với data types
- Trade-offs phải có **bảng so sánh** pros/cons

### Diagrams (Mermaid)
- **Component Diagram**: Bắt buộc trong section 4 (Entities/Components)
- **Sequence Diagram**: Bắt buộc trong section 6 (System Flow) — ít nhất 2 flows
- **ER Diagram**: Bắt buộc trong section 8 (Data Modeling)
- **Architecture Diagram**: Bắt buộc trong section 10 (Architecture Design)

## 🔧 Workflow Khi Tạo Bài Mới

1. Tạo file mới ở **root folder** với tên dạng `kebab-case.md`
2. Copy template từ trên vào file mới
3. Điền nội dung chi tiết cho từng section theo thứ tự 1 → 16
4. Đảm bảo tất cả diagrams render đúng (Mermaid syntax)
5. Đảm bảo diagrams dùng **Mermaid** hoặc **ASCII art** (không dùng file ảnh ngoài)
6. Cập nhật bảng danh sách bài trong `README.md`
6. Review lại toàn bộ nội dung trước khi hoàn tất

## ⚠️ Lưu Ý Quan Trọng

- **KHÔNG** bỏ qua bất kỳ section nào trong template 16 bước
- **KHÔNG** viết nội dung quá chung chung — phải cụ thể cho hệ thống đang thiết kế
- **LUÔN** bao gồm capacity estimation với con số thực tế
- **LUÔN** giải thích **tại sao** chọn giải pháp đó, không chỉ liệt kê
- **LUÔN** đề cập đến các **edge cases** và **failure scenarios**
- Khi cập nhật bài cũ, giữ nguyên cấu trúc template, chỉ bổ sung/sửa nội dung
