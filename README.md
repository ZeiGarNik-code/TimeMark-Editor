# TimeMark Studio

Ứng dụng web chỉnh mốc ngày giờ trên ảnh TimeMark; giao diện hiện dùng tiếng Việt.

## Mở ứng dụng

**https://timemark-studio.vercel.app/**

Không cần tài khoản hay đăng nhập. Sau khi mở trang, có thể chọn ảnh của bạn hoặc dùng ảnh mẫu. Ảnh được giải mã, xem trước, xử lý và xuất ngay trong trình duyệt; ứng dụng không gửi ảnh lên máy chủ hay cơ sở dữ liệu.

## Chạy thử cục bộ

```bash
npm install
npm run dev
```

Mở địa chỉ do Vite hiển thị. Dùng **Ảnh mẫu** để khôi phục ảnh minh hoạ; dùng **Chọn ảnh** để mở JPG, PNG hoặc WebP từ thiết bị.

## Kiểm thử trực tiếp trên web

Mở **Kiểm thử trên web** ở thanh điều hướng bên trái. Bộ test nằm ngay trên màn hình chỉnh sửa và cho phép:

1. Dùng ảnh minh hoạ hoặc chọn ảnh của bạn.
2. Quét lại khung chữ, chạy OCR, rồi kiểm tra nội dung nhận dạng trong phần xem trước OCR.
3. Nạp bộ giá trị thử có địa điểm dài để xem bố cục giờ/ngày quanh gạch cam.
4. Đánh dấu 5 tiêu chí **Đạt/Lỗi**, ghi chú hiện tượng lem/bóng chữ, rồi sao chép báo cáo (nếu trình duyệt chặn clipboard, báo cáo TXT sẽ được tải xuống).

Bộ test là checklist thao tác thủ công trên giao diện; **Kiểm thử và build** phía dưới là bộ test tự động.

## Tính năng

- Quét tương phản ở bốn góc để **gợi ý vùng** có chữ; cho phép chọn góc hoặc kéo để vẽ lại vùng.
- Chạy OCR tiếng Việt + tiếng Anh ngay trong trình duyệt trên vùng đã chọn; xem phần chữ thô, độ tin cậy và trường được nhận dạng trước khi áp dụng vào ô thứ/ngày/giờ/địa điểm.
- Nhập thứ, ngày, giờ và địa điểm; tuỳ chỉnh màu, cỡ chữ, căn lề, khoảng cách dòng, độ đậm, bóng và độ đục. Nút **Khớp ảnh gốc** ước lượng gần đúng màu/cỡ/căn lề/khoảng cách từ vùng chữ đã chọn.
- Lấy mẫu màu mực cũ bằng cách chọn một điểm trên ảnh. Bộ làm sạch tự động dùng OpenCV.js Telea inpainting cục bộ, mở rộng mask nhẹ để xoá viền khử răng cưa/bóng và nhận diện vạch nhấn màu mảnh. Khi phát hiện gạch cam dọc, thời gian được đặt bên trái, ngày/thứ bên phải và gạch được vẽ lại đúng vị trí/màu; địa điểm nằm phía dưới. Nội suy cơ bản là phương án dự phòng nếu chưa nạp được OpenCV.
- Có nút **Tẩy chữ cũ bằng AI** dùng MI-GAN qua ONNX Runtime Web. AI chạy trên ảnh/mask ngay trong trình duyệt (WebGPU nếu có, nếu không thì WebAssembly); ứng dụng không gửi ảnh lên API hay máy chủ. Lần đầu cần tải mô hình MI-GAN khoảng 30 MB từ Hugging Face (có mirror dự phòng); mô hình được lưu trong IndexedDB khi trình duyệt cho phép. Bộ chạy AI được phát cùng ứng dụng. Không có API suy luận trả phí; cần mạng để tải mô hình lần đầu.
- Xuất PNG (không nén mất dữ liệu khi xuất) hoặc JPG chất lượng 97%. Canvas xuất giữ nguyên chiều rộng và chiều cao pixel của ảnh đã mở.
- Giấy phép/phụ thuộc của AI được liệt kê tại [`public/ai/THIRD-PARTY-NOTICES.txt`](public/ai/THIRD-PARTY-NOTICES.txt). Trình duyệt chỉ gửi yêu cầu tải mô hình công khai tới Hugging Face (hoặc mirror); pixel ảnh và mask không được gửi lên.
- Có thể cài như ứng dụng web và dùng ngoại tuyến sau khi mở trang ít nhất một lần (trình duyệt cần hỗ trợ service worker; khi triển khai cần HTTPS). Để OCR, OpenCV và mô hình MI-GAN hoạt động offline, hãy chạy từng tính năng ít nhất một lần khi có kết nối; trình duyệt có thể xoá bộ nhớ đệm hoặc IndexedDB theo chính sách lưu trữ.

## Giới hạn

Bộ quét chỉ gợi ý **vị trí có khả năng chứa chữ**; với khung hẹp ở góc dưới, ứng dụng nới khung vừa đủ để giữ cả khối mốc nhiều dòng nhưng vẫn cần kiểm tra và có thể kéo lại. OCR có thể nhận sai, nhất là trên ảnh nhỏ, chữ mờ hoặc nền phức tạp. Hãy xem văn bản thô/độ tin cậy và soát lại các trường trước khi áp dụng. Telea inpainting giảm vệt chữ cũ so với nội suy đơn giản, nhưng không thể khôi phục chính xác chi tiết bị chữ che trên nền nhiều hoạ tiết; hãy so sánh ảnh gốc và kiểm tra tệp đầu ra.

## Kiểm thử và build

```bash
npm test
npm run build
npm run preview
```
