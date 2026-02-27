# 🏗️ System Design Practice

> Bộ sưu tập các bài thiết kế hệ thống thực tế, phân tích chi tiết theo **System Design Blueprint** — từ requirement gathering đến deployment.

## 📖 Giới Thiệu

Repository này chứa các bài thực hành thiết kế hệ thống (System Design) cho các hệ thống thực tế phổ biến. Mỗi file là **một đề bài hoàn chỉnh** bao gồm:

- 📋 **Yêu cầu bài toán** (Problem Statement)
- 🔍 **Phân tích chi tiết** (Detailed Analysis)
- 🏛️ **Thiết kế hệ thống** (System Design) theo blueprint chuẩn

## 🛠️ Tech Stack Chính

| Layer | Technology |
|-------|-----------|
| **Frontend** | React (TypeScript) |
| **Backend** | Java 17+ / Spring Boot 3.x |
| **Database** | PostgreSQL, Redis, MongoDB (tùy bài) |
| **Message Queue** | Apache Kafka |
| **Cloud** | AWS (EKS, RDS, S3, SQS, CloudFront...) |
| **Orchestration** | Kubernetes (K8s) |
| **IaC** | Terraform |
| **Monitoring** | Prometheus, Grafana, CloudWatch |

> 💡 Ưu tiên tech stack trên, nhưng vẫn sử dụng lựa chọn tốt hơn khi phù hợp (có giải thích lý do).

## 🗺️ System Design Blueprint

Mỗi bài thiết kế đều tuân theo **15 bước** trong System Design Blueprint ([tham khảo](https://kathir-i.medium.com/system-design-blueprint-key-concepts-and-simplified-explanations-0e2c106a5259)):

| # | Bước | Mô tả |
|---|------|--------|
| 1 | **Requirement Gathering & Analysis** | Thu thập và phân tích yêu cầu (Functional & Non-Functional) |
| 2 | **Trade-offs** | Đánh giá các đánh đổi (performance vs cost, consistency vs availability...) |
| 3 | **Defining Entities / Components** | Xác định các thành phần chính của hệ thống |
| 4 | **Client-Server Connection** | Thiết kế giao tiếp giữa client và server (REST, WebSocket, gRPC...) |
| 5 | **System / App Flow** | Thiết kế luồng hoạt động của hệ thống |
| 6 | **API Modeling** | Định nghĩa API endpoints, request/response format |
| 7 | **Data Modeling** | Thiết kế cấu trúc dữ liệu, schema, relationships |
| 8 | **Manager Classes / Services** | Thiết kế các service classes xử lý core operations |
| 9 | **Deciding Architecture** | Chọn kiến trúc phù hợp (Microservices, Monolith, Event-driven...) |
| 10 | **Testing** | Chiến lược kiểm thử (Unit, Integration, Performance, Load) |
| 11 | **Security** | Bảo mật hệ thống (Authentication, Authorization, Encryption...) |
| 12 | **Monitoring & Logging** | Giám sát, logging, alerting |
| 13 | **Maintenance** | CI/CD, automated testing, operational tasks |
| 14 | **Deployment Plans** | Chiến lược triển khai (Blue-Green, Canary, Rolling...) |
| 15 | **Effort Estimation** | Ước lượng effort, timeline, resources |

## 📂 Danh Sách Bài Thiết Kế

### 🟢 Cơ bản (Basic)

| # | Bài toán | File | Độ khó |
|---|---------|------|--------|
| 1 | URL Shortener (TinyURL) | [url-shortener.md](./url-shortener.md) | ⭐⭐ |
| 2 | Paste Bin | [paste-bin.md](./paste-bin.md) | ⭐⭐ |
| 3 | Rate Limiter | [rate-limiter.md](./rate-limiter.md) | ⭐⭐ |

### 🟡 Trung bình (Intermediate)

| # | Bài toán | File | Độ khó |
|---|---------|------|--------|
| 4 | Chat System (WhatsApp/Messenger) | [chat-system.md](./chat-system.md) | ⭐⭐⭐ |
| 5 | News Feed (Facebook/Twitter) | [news-feed.md](./news-feed.md) | ⭐⭐⭐ |
| 6 | Notification System | [notification-system.md](./notification-system.md) | ⭐⭐⭐ |
| 7 | Search Autocomplete | [search-autocomplete.md](./search-autocomplete.md) | ⭐⭐⭐ |
| 8 | Web Crawler | [web-crawler.md](./web-crawler.md) | ⭐⭐⭐ |

### 🔴 Nâng cao (Advanced)

| # | Bài toán | File | Độ khó |
|---|---------|------|--------|
| 9 | Video Streaming (YouTube/Netflix) | [video-streaming.md](./video-streaming.md) | ⭐⭐⭐⭐ |
| 10 | Distributed Cache (Redis) | [distributed-cache.md](./distributed-cache.md) | ⭐⭐⭐⭐ |
| 11 | E-Commerce Platform (Shopee/Amazon) | [e-commerce.md](./e-commerce.md) | ⭐⭐⭐⭐ |
| 12 | Ride Sharing (Grab/Uber) | [ride-sharing.md](./ride-sharing.md) | ⭐⭐⭐⭐ |
| 13 | Distributed Message Queue (Kafka) | [message-queue.md](./message-queue.md) | ⭐⭐⭐⭐⭐ |
| 14 | Google Maps | [google-maps.md](./google-maps.md) | ⭐⭐⭐⭐⭐ |
| 15 | Payment System (VNPay/Stripe) | [payment-system.md](./payment-system.md) | ⭐⭐⭐⭐⭐ |

## 📐 Template Chuẩn Cho Mỗi Bài

Mỗi bài thiết kế sẽ tuân theo template sau:

```markdown
# [Tên Hệ Thống] - System Design

## 1. Đề Bài (Problem Statement)
## 2. Requirement Gathering & Analysis
   ### 2.1 Functional Requirements
   ### 2.2 Non-Functional Requirements
   ### 2.3 Capacity Estimation
## 3. Trade-offs
## 4. Defining Entities / Components
## 5. Client-Server Connection
## 6. System / App Flow
## 7. API Modeling
## 8. Data Modeling
## 9. Manager Classes / Services
## 10. Architecture Design
## 11. Testing Strategy
## 12. Security
## 13. Monitoring & Logging
## 14. Maintenance
## 15. Deployment Plans
## 16. Effort Estimation
```

## 🎯 Mục Tiêu

- ✅ Rèn luyện tư duy thiết kế hệ thống có cấu trúc
- ✅ Áp dụng blueprint chuẩn cho mọi bài toán
- ✅ Phân tích chi tiết các trade-off trong thực tế
- ✅ Chuẩn bị cho phỏng vấn System Design
- ✅ Xây dựng portfolio kiến thức system design

## 🛠️ Cách Sử Dụng

1. **Đọc đề bài** — Hiểu rõ yêu cầu bài toán
2. **Tự thiết kế** — Thử thiết kế trước khi xem lời giải
3. **So sánh** — Đối chiếu với thiết kế chi tiết trong file
4. **Ghi chú** — Tạo notes cho những điểm cần nhớ

## 📚 Tài Liệu Tham Khảo

- [System Design Blueprint](https://kathir-i.medium.com/system-design-blueprint-key-concepts-and-simplified-explanations-0e2c106a5259) — Blueprint gốc
- [System Design Primer](https://github.com/donnemartin/system-design-primer) — Tổng hợp kiến thức
- [Designing Data-Intensive Applications](https://dataintensive.net/) — Sách kinh điển
- [ByteByteGo](https://bytebytego.com/) — Giải thích trực quan

## 📝 Đóng Góp

Mọi đóng góp đều được chào đón! Vui lòng:

1. Fork repository
2. Tạo branch mới (`git checkout -b feature/ten-bai-moi`)
3. Commit thay đổi (`git commit -m 'Add: Thiết kế hệ thống XYZ'`)
4. Push branch (`git push origin feature/ten-bai-moi`)
5. Tạo Pull Request

## 📜 License

Dự án này được phân phối dưới giấy phép [MIT](LICENSE).

---

> 💡 **Tip:** Bắt đầu với các bài cơ bản (🟢) và dần nâng lên các bài nâng cao (🔴). Hãy tập trung vào việc hiểu **tại sao** chọn giải pháp đó thay vì chỉ ghi nhớ.
