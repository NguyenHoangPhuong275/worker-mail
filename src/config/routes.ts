import { telegramOtpHandler } from "../features/telegram-otp/handler";
import { drop } from "../features/drop/handler";
import type { MailRoute } from "../mail/types";

// Rule cụ thể khớp trước. "*" là đích cuối cho mọi địa chỉ còn lại.
// Thêm tính năng: tạo src/features/<tên>/handler.ts rồi thêm một dòng vào mảng này.
export const mailRoutes: readonly MailRoute[] = [
  {
    match: "drop",
    action: "drop",
    summary: "Nhận thư rồi bỏ. Không lưu và không gửi thông báo.",
    handler: drop,
  },
  {
    match: "*",
    action: "telegram-otp",
    summary: "Nhận và lưu thư theo cấu hình; tìm mã xác nhận và link kích hoạt nếu có.",
    handler: telegramOtpHandler,
  },
];
