# worker-mail

Giao diện hộp thư được phục vụ từ `public/index.html` và `public/assets`. Danh sách và nội dung thư mới nhất dùng `/api/mail/messages?to=...`; nội dung từng thư dùng `/api/mail/message?to=...&id=...`. Địa chỉ được giữ trong URL, localStorage và sessionStorage nên F5 vẫn mở đúng hộp thư.

Danh sách domain của giao diện lấy từ cấu hình máy chủ qua `/api/console`, không có danh sách dự phòng ghi sẵn trong JavaScript. Nút **Địa chỉ mới** tạo tên ngẫu nhiên, chọn ngẫu nhiên domain đã cấu hình và tự sao chép địa chỉ vừa tạo; nếu có nhiều domain thì tránh domain vừa dùng. Chỉ một domain thì đổi tên địa chỉ. Đợi tải cấu hình xong mới cho tạo/sao chép địa chỉ; F5 vẫn giữ hộp thư đang dùng và **Đổi địa chỉ** vẫn cho chọn domain thủ công.

Cloudflare Worker nhận mail trên domain của bạn. Hành vi của từng địa chỉ khai báo ở `src/config/routes.ts`.

```text
src/
  index.ts                 cổng vào: email và HTTP
  config/
    env.ts                 biến và binding
    routes.ts              địa chỉ → tính năng
  mail/
    mailbox.ts             nhận yêu cầu và quản lý kết nối trực tiếp
    mailbox-store.ts       SQLite, nội dung thư, danh sách và thời hạn lưu
    repository.ts          kết nối hộp thư và chuyển dữ liệu KV cũ
    otp.ts                 nhận diện mã xác thực theo ngữ cảnh
    pipeline.ts            điều phối thư đến theo route
  features/<tên>/          một thư mục cho một tính năng
  http/                    /health, /api/console, tra cứu thư
public/assets/
  app.js                   điều phối hộp thư và thao tác người dùng
  inbox-view.js            hiển thị danh sách, thư và thời hạn OTP
  mail-renderer.js         làm sạch HTML và tải tệp đính kèm
  live-mailbox.js          kết nối trực tiếp, heartbeat và tự nối lại
  api-client.js            yêu cầu HTTP, thời gian chờ và hủy yêu cầu
```

Thêm tính năng: tạo `src/features/<tên>/handler.ts` export một `MailHandler`, rồi thêm một dòng vào `mailRoutes`. Rule cụ thể được xét trước. `*` nhận mọi địa chỉ còn lại. `sales` cũng khớp `sales+tag`.

Danh sách thư dùng chỉ mục theo thời gian nhận. Khi phát một cập nhật cho nhiều kết nối, mỗi hộp thư chỉ đọc danh sách một lần và dùng lại nội dung đã có trong lần xử lý đó; bộ nhớ tạm được giải phóng sau khi phát xong. Tra cứu một thư hoặc mở kết nối trực tiếp chỉ kiểm tra trạng thái chuyển dữ liệu cũ, không tải dư thư mới nhất. Nhận diện OTP lập vị trí các nhãn một lần rồi chỉ xét ngữ cảnh gần mã, thay vì quét lại toàn bộ nội dung cho từng số.

Các domain trong `MAIL_DOMAINS` và `addresses` được cấu hình ở `wrangler.jsonc`. Wrangler quản lý catch-all cho từng domain. Mỗi người nhận dùng một SQLite Durable Object qua binding `MAILBOXES`. Worker hoàn thành lưu thư trước khi chấp nhận email; đường đọc chính không phụ thuộc bộ nhớ đệm KV. Thư cũ còn trong KV được chuyển một lần khi mở hộp thư. `MAIL_RETENTION_SECONDS=0` là mặc định: giữ thư, không tự xóa. Có thể đặt số giây dương để chủ động bật thời hạn lưu. Khi tắt thời hạn, các bản ghi còn trong SQLite được giữ lại kể cả đã tới hạn cũ; thư đã bị xóa trước đó không thể phục hồi bằng thay đổi này. Alarm vẫn quản lý thời hạn phiên WebSocket, nhưng không xóa thư khi cấu hình bằng 0.

Hộp thư hiển thị 50 thư mới nhất và nhận cập nhật qua WebSocket ngay sau khi lưu thư. OTP được đẩy trước nội dung lớn/tệp đính kèm; thư thông thường đến sau không che mã đang hiển thị. Kết nối tự nối lại và lấy bù OTP bị lỡ. Khi mất kênh trực tiếp, HTTP kiểm tra mỗi giây; khi đang kết nối, đối chiếu mỗi 15 giây. Thời gian gửi từ dịch vụ bên ngoài và mạng không nằm trong bảo đảm độ trễ của ứng dụng.

Email HTML được làm sạch bằng DOMPurify và hiển thị trong iframe sandbox; thư văn bản, ảnh nhúng CID và tệp đính kèm cũng được hỗ trợ. Mã xác nhận chỉ hiện khi có ngữ cảnh xác thực rõ ràng; mã khuyến mãi, đơn hàng, số trong URL và mã được trích dẫn không được đoán là OTP. Có nhãn đăng nhập/xác minh email/đặt lại mật khẩu và thời gian nhận; chỉ tính hết hạn khi email ghi rõ thời hạn. Nhiều mã khác nhau không được tự chọn. Nhận diện được tính lại khi đọc để sửa cả các thư cũ bị gắn OTP sai. OTP hết hạn thì ngừng gợi ý sao chép; email vẫn được giữ lại.

`API_AUTH_TOKEN` là khóa riêng của hộp thư, lưu trong `.env` khi chạy local và dưới dạng Worker secret khi deploy. Chạy `npm run dev` để tải `.env`; trình duyệt local tự nhận phiên kết nối HttpOnly, không cần nhập mã vào giao diện. Phiên có hiệu lực 8 giờ. Trên domain công khai, cần mã truy cập hoặc phiên đã đăng nhập. Không đưa mã truy cập Cloudflare vào cấu hình giao diện.

`MAIL_API_BASE_URL` trong `.env` kết nối bản local với Worker đang chạy trên Cloudflare. Các yêu cầu hộp thư đi qua máy chủ local; `API_AUTH_TOKEN` không xuất hiện trong mã giao diện. Bỏ biến này để dùng hộp thư local. `/health` trả trạng thái dịch vụ; `/` mở hộp thư.

Kiểm tra: `npm run check`, `npm test`. Để kiểm tra email qua handler local, chạy `npx wrangler dev --port 8793 --persist-to .wrangler/mailbox-e2e`, rồi `npm run test:mail` và `npm run test:live`. Các bài kiểm tra gồm đẩy OTP đồng thời, nối lại/lấy bù, HTTP dự phòng, phân biệt hộp thư và giữ thư qua alarm; không gửi email ra bên ngoài. Sau khi cập nhật DOMPurify, chạy `npm run vendor:sync` để cập nhật bản phục vụ trên trình duyệt.
