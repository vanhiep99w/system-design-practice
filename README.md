# 🏗️ System Design Practice

> Bộ sưu tập các bài thiết kế hệ thống thực tế, phân tích chi tiết theo **System Design Blueprint** — từ requirement gathering đến deployment.

## 📖 Giới Thiệu

Repository này chứa các bài thực hành thiết kế hệ thống (System Design) cho các hệ thống thực tế phổ biến. 

## 📂 Danh Sách Bài Thiết Kế

### 🟢 Cơ bản (Basic)

| # | Bài toán | File | Độ khó | Trạng thái |
|---|---------|------|--------|------------|
| 1 | URL Shortener (TinyURL) | [url-shortener.md](./url-shortener.md) | ⭐⭐ | ✅ Done |
| 2 | Paste Bin | [paste-bin.md](./paste-bin.md) | ⭐⭐ | ✅ Done |
| 3 | Rate Limiter | [rate-limiter.md](./rate-limiter.md) | ⭐⭐ | ✅ Done |

### 🟡 Trung bình (Intermediate)

| # | Bài toán | File | Độ khó | Trạng thái |
|---|---------|------|--------|------------|
| 4 | Chat System (WhatsApp/Messenger) | [chat-system.md](./chat-system.md) | ⭐⭐⭐ | ✅ Done |
| 5 | News Feed (Facebook/Twitter) | [news-feed.md](./news-feed.md) | ⭐⭐⭐ | ✅ Done |
| 6 | Notification System | [notification-system.md](./notification-system.md) | ⭐⭐⭐ | ⬜ Todo |
| 7 | Search Autocomplete | [search-autocomplete.md](./search-autocomplete.md) | ⭐⭐⭐ | ⬜ Todo |
| 8 | Web Crawler | [web-crawler.md](./web-crawler.md) | ⭐⭐⭐ | ⬜ Todo |

### 🔴 Nâng cao (Advanced)

| # | Bài toán | File | Độ khó | Trạng thái |
|---|---------|------|--------|------------|
| 9 | Video Streaming (YouTube/Netflix) | [video-streaming.md](./video-streaming.md) | ⭐⭐⭐⭐ | ⬜ Todo |
| 10 | Distributed Cache (Redis) | [distributed-cache.md](./distributed-cache.md) | ⭐⭐⭐⭐ | ⬜ Todo |
| 11 | E-Commerce Platform (Shopee/Amazon) | [e-commerce.md](./e-commerce.md) | ⭐⭐⭐⭐ | ⬜ Todo |
| 12 | Ride Sharing (Grab/Uber) | [ride-sharing.md](./ride-sharing.md) | ⭐⭐⭐⭐ | ⬜ Todo |
| 13 | Distributed Message Queue (Kafka) | [message-queue.md](./message-queue.md) | ⭐⭐⭐⭐⭐ | ⬜ Todo |
| 14 | Google Maps | [google-maps.md](./google-maps.md) | ⭐⭐⭐⭐⭐ | ⬜ Todo |
| 15 | Payment System (VNPay/Stripe) | [payment-system.md](./payment-system.md) | ⭐⭐⭐⭐⭐ | ⬜ Todo |

## 🎯 Mục Tiêu

- ✅ Rèn luyện tư duy thiết kế hệ thống có cấu trúc
- ✅ Áp dụng blueprint chuẩn cho mọi bài toán
- ✅ Phân tích chi tiết các trade-off trong thực tế
- ✅ Chuẩn bị cho phỏng vấn System Design
- ✅ Xây dựng portfolio kiến thức system design

## 🖥️ Đọc Tài Liệu Trên Website

Website dùng Next.js/Fumadocs và [`@vanhiep99w/docs-kit`](https://www.npmjs.com/package/@vanhiep99w/docs-kit). Cần **Node.js 22+**; không cần D2 CLI, Go hay Java để build.

```bash
npm ci
npm run dev
# Kiểm tra trước khi deploy:
npm test
npm run typecheck
npm run build
```

- **Nguồn chuẩn:** sửa 5 bài `.md` ở root. `content/docs/` được sinh lại bởi `prepare-content`, `predev` và `prebuild`; không sửa bản generated.
- **Static export:** output nằm ở `dist/`, dùng được trên Cloudflare Pages. D2/WASM và syntax highlighting chỉ chạy lúc build, không chạy trong browser.
- **D2 layout:** mặc định dùng **TALA** cho toàn bộ diagram D2 (`layout: 'tala'` trong `source.config.ts`). Có thể override từng fence bằng `layout=elk` hoặc `layout=dagre`; Mermaid không bị ảnh hưởng.
- **D2 preview:** từ docs-kit `0.9.2`, preview tương tác tự fit chiều rộng bài và tối đa `65vh`, giữ nguyên tỷ lệ; bấm Explore để zoom/pan đọc chi tiết. Có thể chỉnh giới hạn bằng `--d2-preview-max-height` trong CSS của site; nút Fit trong viewer tính cả hai chiều.
- **D2 cache:** `.next/cache/docs-kit/d2` (đã ignore). Có thể xóa để kiểm tra cold build; cache không phải artifact deploy.

### 🧩 Component Đang Sử Dụng

| Fence | Dùng khi nào | Ví dụ trong repo |
|---|---|---|
| `d2 interactive` | Architecture/component, flow tuyến tính; Explore để zoom/pan, xem source và tải SVG | §4 và §10 của cả 5 bài; §6 Flow 3 của Rate Limiter |
| `protocol-exchange` | Cặp HTTP request/response, giữ header, raw body và integer ID lớn | §7 của cả 5 bài |
| `code-walkthrough` | Đọc core Java service theo từng bước, highlight dòng và copy toàn bộ code | §9 của cả 5 bài |
| `terminal-session` | Runbook có context và cảnh báo; **không thực thi lệnh** | §15 Rate Limiter — rollback staging |
| `span-waterfall` | Phân tích latency qua trace có parent/child, **ghi rõ dữ liệu minh họa hay đo thật** | §13 URL Shortener — cache miss |

Giữ Mermaid cho ER cardinality và sequence có `alt/par/loop` khi D2 không biểu đạt tương đương. Cây thư mục, bit layout, payload và pseudo-code vẫn là text, không ép thành diagram. Source Explorer/Code Diff chưa cần dùng khi chưa có source project hoặc thay đổi trước/sau thực sự.

### ✍️ Viết D2 Và Dùng Icon

````markdown
```d2 interactive title="Read path"
direction: right
api: Redirect Service
cache: Redis {
  shape: cylinder
  icon: ./diagrams/icons/redis.svg
}
api -> cache: GET mapping
```
````

- Diagram nằm trực tiếp trong Markdown. Các fence được compile qua remark plugin trong `source.config.ts`; React component map ở `src/mdx-components.tsx`, CSS trong `src/app/globals.css`.
- Icon chọn từ [D2 Icons](https://icons.d2lang.com/) đã được lưu tại `diagrams/icons/`; URL nguồn nằm trong [`sources.json`](./diagrams/icons/sources.json). Dùng icon đúng dịch vụ, không dùng biểu tượng AWS cho công nghệ self-hosted tương ứng.
- Viết `icon: ./diagrams/icons/<name>.svg` trên một dòng riêng trong D2 ở file root. Pipeline tự đổi đường dẫn thành `../../diagrams/icons/…` ở bản generated và nhúng SVG từ allowlist `assetsRoot`; người đọc không phải gọi CDN icon.
- Icon mới cần được review, lưu local và bổ sung URL gốc vào `sources.json`. Không trỏ `assetsRoot` vào toàn bộ repo hoặc dùng symlink.
- Chỉ compile MDX/D2 và descriptor do tác giả tin cậy quản lý. Các component là minh họa tĩnh, không chạy code/API/shell; không đưa secrets hay dữ liệu production vào ví dụ.
- Tham khảo [API và descriptor của docs-kit](https://github.com/vanhiep99w/docs-kit/tree/main/docs) trước khi thêm component. Chỉ đăng ký plugin/component/CSS khi thực sự dùng, giữ nguyên blueprint 17 bước.

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
