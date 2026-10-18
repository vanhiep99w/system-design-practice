# Icon cho D2

Các SVG trong thư mục này được lấy từ https://icons.d2lang.com/ để minh họa đúng công nghệ/dịch vụ trong bài viết. URL gốc cho từng file được lưu trong `sources.json`.

- AWS service icons chỉ dùng cho dịch vụ AWS tương ứng; PostgreSQL/Redis dùng logo công nghệ tương ứng.
- Bản quyền và nhãn hiệu thuộc chủ sở hữu tương ứng; việc lưu trong repo không chuyển quyền sở hữu hoặc tái cấp phép các nhãn hiệu.
- D2 nhúng icon lúc build thông qua `assetsRoot: 'diagrams/icons'`. Không cần request icon tới bên thứ ba khi đọc website.
- Trong Markdown ở root: `icon: ./diagrams/icons/redis.svg`, trên dòng riêng. `prepare-content` rebase đường dẫn cho bản generated trong `content/docs/`.
- Chỉ thêm SVG đã review từ nguồn tin cậy; giữ nguồn tải trong manifest. Không dùng thư mục này để chứa source hoặc dữ liệu không liên quan.
