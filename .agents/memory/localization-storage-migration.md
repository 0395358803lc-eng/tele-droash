---
name: Di trú dữ liệu khi bản địa hóa
description: Quy tắc giữ dữ liệu sandbox cục bộ khi thay đổi ngôn ngữ hiển thị.
---

Khi bản địa hóa một ứng dụng có dữ liệu mẫu hoặc dữ liệu người dùng trong localStorage, không nên chỉ thay giá trị mặc định. Hãy đọc khóa hiện tại, hỗ trợ khóa cũ nếu cần, và di trú các nhãn mẫu đã biết để dữ liệu đang tồn tại cũng nhất quán với giao diện mới.

**Why:** Người dùng có thể đã mở ứng dụng trước khi bản địa hóa; nếu chỉ cập nhật dữ liệu mặc định, trình duyệt của họ vẫn hiển thị các nhãn cũ.

**How to apply:** Dùng fallback khóa lưu trữ cũ và ánh xạ có giới hạn cho dữ liệu mẫu; giữ nguyên các tên do người dùng tự nhập.