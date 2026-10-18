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
- **D2 layout:** mặc định dùng **TALA** cho toàn bộ diagram D2 (`layout: 'tala'` trong `source.config.ts`). Có thể override từng fence bằng `layout=elk` hoặc `layout=dagre`.
- **D2 viewer:** từ docs-kit `0.9.3`, mở sẵn với icon zoom/fit/fullscreen nổi ở góc phải canvas (không chiếm header), tự fit theo hai chiều; mặc định tối đa `90vh`. Sequence dài có thể đặt **riêng từng diagram** bằng comment `# viewport-height: 140vh` trong source D2 (host convention, không phải syntax cấu hình của D2/docs-kit). Adapter tại `src/mdx-components.tsx` áp cùng mức cho viewer và SSR/no-JS; diagram không có comment giữ nguyên `90vh`. Các flow hiện chọn `100`–`190vh` theo tỷ lệ sau khi fit chiều ngang, không áp một mức chung. Architecture/ER không đổi; fullscreen vẫn cao `90dvh`. Source nằm trong panel nổi từ icon `</>`, không có footer. Site giữ `scale: 1`. Nhãn sequence dài được ngắt dòng, không đổi thứ tự message hay payload trong ví dụ API.
- **Sequence frames:** docs-kit `0.9.8` cung cấp viền/nền group và padding mặc định dùng chung; không còn CSS màu/viền/padding sửa riêng tại host. Các nhánh chỉ giữ `stroke-dash: 4` trong source D2 để phân biệt với group ngoài. Adapter host chỉ giữ chiều cao riêng từng flow.
- **D2 cache:** `.next/cache/docs-kit/d2` (đã ignore). Có thể xóa để kiểm tra cold build; cache không phải artifact deploy.

### 🧩 Component Đang Sử Dụng

| Fence | Dùng khi nào | Ví dụ trong repo |
|---|---|---|
| `d2 interactive` | Architecture/component, sequence (`shape: sequence_diagram`) và ER (`shape: sql_table`); zoom/pan/fullscreen trực tiếp, source và tải SVG qua icon | §4, §6, §8 và §10 của cả 5 bài |
| `protocol-exchange` | Cặp HTTP request/response, giữ header, raw body và integer ID lớn | §7 của cả 5 bài |
| `code-walkthrough` | Đọc core Java service theo từng bước, highlight dòng và copy toàn bộ code | §9 của cả 5 bài |
| `terminal-session` | Runbook có context và cảnh báo; **không thực thi lệnh** | §15 Rate Limiter — rollback staging |
| `span-waterfall` | Phân tích latency qua trace có parent/child, **ghi rõ dữ liệu minh họa hay đo thật** | §13 URL Shortener — cache miss |

Toàn bộ sequence ở §6 dùng D2, gồm cả nhánh điều kiện, vòng lặp và xử lý song song. Group `alt` chứa các nhánh loại trừ nhau, `loop` ghi rõ phần lặp, `par` ghi rõ các nhánh song song (vị trí dọc không biểu thị thứ tự thực thi). Đây là quy ước nhãn trong diagram, không phải control-flow DSL thực thi của D2. ER diagram ở §8 dùng `sql_table`, constraint `primary_key`/`foreign_key`/`unique` (hỗ trợ array cho PK+FK) và đầu nối crow’s foot `cf-one-required`/`cf-many`/`cf-one` để giữ cardinality. Renderer, remark plugin và dependency Mermaid đã được gỡ. Cây thư mục, bit layout, payload và pseudo-code vẫn là text, không ép thành diagram. Source Explorer/Code Diff chưa cần dùng khi chưa có source project hoặc thay đổi trước/sau thực sự.

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
- ER: dùng [`sql_table`](https://www.d2lang.com/tour/sql-tables/), quote tên cột trùng reserved keyword (ví dụ `"type"`), constraint kép như `constraint: [primary_key; foreign_key]`. `unique` hiển thị là `UNQ`, tương đương `UK` ở sơ đồ cũ. Nối đúng `TABLE."column"` và dùng cả hai arrowhead (`<->`) để hiển thị [crow’s foot](https://www.d2lang.com/tour/connections/#arrowheads). Các tham chiếu logic không đồng nghĩa với SQL foreign key được database enforce; DDL vẫn là nguồn chuẩn.
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
