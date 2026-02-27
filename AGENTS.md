# AGENTS.md — Hướng Dẫn Cho AI Agent

## 📋 Tổng Quan Dự Án

Đây là repository chứa các bài thực hành **System Design** cho các hệ thống thực tế. Mỗi file markdown trong thư mục `designs/` là một bài thiết kế hoàn chỉnh theo chuẩn **System Design Blueprint** gồm 15 bước.

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

Khi tạo mới hoặc chỉnh sửa bài thiết kế, **BẮT BUỘC** tuân theo template dưới đây. Mỗi section tương ứng với một bước trong System Design Blueprint:

```markdown
# [Tên Hệ Thống] - System Design

## 1. 📋 Đề Bài (Problem Statement)
- Mô tả ngắn gọn về hệ thống cần thiết kế
- Bối cảnh thực tế và tầm quan trọng
- Phạm vi thiết kế (scope)

## 2. 🔍 Requirement Gathering & Analysis

### 2.1 Functional Requirements
- Liệt kê tất cả chức năng bắt buộc
- Ưu tiên: MUST-HAVE vs NICE-TO-HAVE
- Mô tả rõ user interactions

### 2.2 Non-Functional Requirements
- **Performance**: Latency targets, throughput
- **Scalability**: Concurrent users, data growth
- **Availability**: Uptime SLA (99.9%, 99.99%...)
- **Consistency**: Strong vs eventual consistency
- **Security**: Authentication, encryption
- **Observability**: Metrics, logs, traces

### 2.3 Capacity Estimation (Back-of-the-envelope)
- Daily Active Users (DAU)
- Queries Per Second (QPS) — read & write
- Storage requirements (daily/monthly/yearly)
- Bandwidth estimation
- Memory/Cache estimation

## 3. ⚖️ Trade-offs
- Liệt kê các quyết định trade-off quan trọng
- Sử dụng format: **[Option A] vs [Option B]**
- Giải thích lý do chọn, ưu/nhược điểm
- Ví dụ: SQL vs NoSQL, Push vs Pull, CP vs AP (CAP theorem)

## 4. 🧩 Defining Entities / Components
- High-level components diagram (mermaid)
- Mô tả vai trò từng component
- Các thành phần: Client, API Gateway, Services, Database, Cache, Queue, CDN...

## 5. 🔗 Client-Server Connection
- Protocol: REST / GraphQL / gRPC / WebSocket
- Authentication: JWT / OAuth2 / API Key
- Connection patterns: Request-Response, Pub-Sub, Streaming
- Rate limiting & throttling strategy

## 6. 🔄 System / App Flow
- User flow diagrams (mermaid sequence/flowchart)
- Core use case flows chi tiết
- Error handling flows
- Edge cases

## 7. 📡 API Modeling
- Endpoint definitions (method, path, params)
- Request/Response format (JSON examples)
- Error response format
- Pagination, filtering, sorting strategy
- API versioning strategy

## 8. 🗄️ Data Modeling
- Database schema design (tables, columns, types)
- Entity Relationship Diagram (mermaid ER diagram)
- Indexing strategy
- Partitioning / sharding strategy
- Data retention policy

## 9. ⚙️ Manager Classes / Services
- Service decomposition (Spring Boot microservices)
- Core service classes và responsibilities (@Service, @Component)
- Shared/common services (Spring Security, Spring AOP logging, notification...)
- Service communication patterns (REST via RestTemplate/WebClient, Kafka events)
- Dependency injection & bean management

## 10. 🏛️ Architecture Design
- Overall architecture pattern (Microservices, Monolith, Serverless...)
- Architecture diagram chi tiết (mermaid) — chỉ rõ AWS services
- Scaling strategy: EKS auto-scaling (HPA/VPA), RDS read replicas
- Caching strategy: Redis (ElastiCache) — layers, eviction policy
- Load balancing: ALB/NLB trên AWS
- CDN strategy: CloudFront (nếu applicable)
- Message queue: Kafka (MSK) / SQS cho event-driven components
- Service mesh & API Gateway (Spring Cloud Gateway / AWS API Gateway)

## 11. 🧪 Testing Strategy
- Unit testing: JUnit 5, Mockito — scope & coverage targets (>80%)
- Integration testing: Spring Boot Test, Testcontainers
- Load testing: JMeter / Gatling — performance benchmarks
- Chaos engineering: AWS Fault Injection Simulator
- E2E testing: Cypress/Playwright (frontend), REST Assured (API)
- Contract testing: Spring Cloud Contract (nếu microservices)

## 12. 🔒 Security
- Authentication & Authorization
- Data encryption (at rest, in transit)
- Input validation & sanitization
- DDoS protection
- Security audit & compliance
- OWASP Top 10 considerations

## 13. 📊 Monitoring & Logging
- Key metrics (latency, error rate, throughput, saturation)
- Logging strategy (structured logging, log levels)
- Alerting rules & thresholds
- Distributed tracing
- Dashboard design
- Incident response workflow

## 14. 🔧 Maintenance
- CI/CD pipeline: GitHub Actions / Jenkins (build → test → deploy to EKS)
- Database migration: Flyway / Liquibase
- Feature flag management: LaunchDarkly / custom config
- Technical debt management
- Documentation maintenance (Swagger/OpenAPI cho API docs)

## 15. 🚀 Deployment Plans
- Deployment strategy: Blue-Green / Canary / Rolling trên K8s
- Rollback plan: Kubernetes rollout undo, Terraform state management
- Infrastructure as Code: **Terraform** (VPC, EKS, RDS, ElastiCache, S3...)
- Auto-scaling: K8s HPA/VPA + AWS Auto Scaling Groups
- Multi-region deployment trên AWS (nếu applicable)
- Helm charts cho K8s deployments
- Docker multi-stage builds cho Spring Boot apps

## 16. ⏱️ Effort Estimation
- Phase breakdown & timeline
- Team composition & roles
- Risk assessment
- Dependencies & blockers
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
