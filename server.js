/*
 * Backend Socket.io cho ứng dụng Healing Station.
 * Chức năng chính:
 * 1. Cho người dùng ẩn danh kết nối realtime.
 * 2. Chat riêng 1-1.
 * 3. Chat nhóm theo phòng.
 * 4. Theo dõi danh sách online/offline.
 * 5. Cung cấp REST API kiểm tra trạng thái server.
 */

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

/*
 * Khởi tạo Express app.
 * Express dùng để tạo các REST API đơn giản.
 */
const ungDung = express();

/*
 * Cho phép server nhận JSON từ request body.
 */
ungDung.use(express.json());

/*
 * Cho phép client khác domain/IP gọi vào backend.
 * Khi làm thật nên giới hạn origin, không nên để "*".
 */
ungDung.use(cors({
    origin: "*"
}));

/*
 * Tạo HTTP server từ Express.
 * Socket.io sẽ chạy bám trên HTTP server này.
 */
const mayChuHttp = http.createServer(ungDung);

/*
 * Khởi tạo Socket.io server.
 * cors mở rộng để Android hoặc web client có thể kết nối khi test.
 */
const io = new Server(mayChuHttp, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

/*
 * Cổng chạy server.
 * Android sau này sẽ kết nối tới IP máy tính + cổng này.
 */
const CONG_SERVER = process.env.PORT || 3000;

/*
 * Cấu hình nơi lưu lịch sử tin nhắn.
 * Backend sẽ tạo thư mục du_lieu và file tin_nhan.json nếu chưa có.
 */
const THU_MUC_DU_LIEU = path.join(__dirname, "du_lieu");
const FILE_TIN_NHAN = path.join(THU_MUC_DU_LIEU, "tin_nhan.json");

/*
 * Đảm bảo thư mục và file dữ liệu luôn tồn tại.
 */
function hamKhoiTaoFileDuLieu() {
    if (!fs.existsSync(THU_MUC_DU_LIEU)) {
        fs.mkdirSync(THU_MUC_DU_LIEU);
    }

    if (!fs.existsSync(FILE_TIN_NHAN)) {
        fs.writeFileSync(FILE_TIN_NHAN, "[]", "utf8");
    }
}

hamKhoiTaoFileDuLieu();

/*
 * Lưu danh sách người dùng online.
 * Key: maNguoiDung
 * Value: thông tin người dùng và socketId.
 */
const danhSachNguoiDungOnline = new Map();

/*
 * Lưu ánh xạ socketId sang mã người dùng.
 * Dùng để xóa đúng người khi socket disconnect.
 */
const bangSocketNguoiDung = new Map();

/*
 * Lưu lịch sử tin nhắn tạm trong RAM.
 * Khi tắt server thì dữ liệu mất.
 * Sau này có thể thay bằng MongoDB/MySQL.
 */
const lichSuTinNhan = [];

/*
 * Đọc lịch sử tin nhắn từ file JSON.
 */
function hamDocLichSuTinNhanTuFile() {
    try {
        const noiDungFile = fs.readFileSync(FILE_TIN_NHAN, "utf8");

        if (!noiDungFile || noiDungFile.trim().length === 0) {
            return [];
        }

        return JSON.parse(noiDungFile);
    } catch (loi) {
        console.log("Không đọc được file tin nhắn:", loi.message);
        return [];
    }
}

/*
 * Ghi lịch sử tin nhắn xuống file JSON.
 */
function hamGhiLichSuTinNhanRaFile(danhSachTinNhan) {
    try {
        fs.writeFileSync(
            FILE_TIN_NHAN,
            JSON.stringify(danhSachTinNhan, null, 2),
            "utf8"
        );
    } catch (loi) {
        console.log("Không ghi được file tin nhắn:", loi.message);
    }
}

/*
 * REST API kiểm tra server còn sống hay không.
 */
ungDung.get("/", function (req, res) {
    res.json({
        thanh_cong: true,
        ten_he_thong: "Healing Station Backend",
        trang_thai: "dang_hoat_dong",
        cong: CONG_SERVER,
        so_nguoi_online: danhSachNguoiDungOnline.size
    });
});

/*
 * REST API lấy danh sách người dùng đang online.
 */
ungDung.get("/danh-sach-online", function (req, res) {
    res.json({
        thanh_cong: true,
        so_luong: danhSachNguoiDungOnline.size,
        danh_sach: Array.from(danhSachNguoiDungOnline.values())
    });
});

/*
 * REST API lấy lịch sử tin nhắn tạm.
 * Có thể dùng để test nhanh trên trình duyệt.
 */
ungDung.get("/lich-su-tin-nhan", function (req, res) {
    const danhSachTinNhan = hamDocLichSuTinNhanTuFile();

    res.json({
        thanh_cong: true,
        so_luong: danhSachTinNhan.length,
        danh_sach: danhSachTinNhan
    });
});

/*
 * API lấy lịch sử tin nhắn nhóm theo mã phòng.
 * Ví dụ:
 * http://localhost:3000/lich-su-nhom/phong_chung
 */
ungDung.get("/lich-su-nhom/:maPhong", function (req, res) {
    const maPhong = hamChuanHoaChuoi(req.params.maPhong, "phong_chung");
    const danhSachTinNhan = hamDocLichSuTinNhanTuFile();

    const ketQua = danhSachTinNhan.filter(function (tinNhan) {
        return tinNhan.loai_tin_nhan === "nhom"
            && tinNhan.ma_phong === maPhong;
    });

    res.json({
        thanh_cong: true,
        loai: "nhom",
        ma_phong: maPhong,
        so_luong: ketQua.length,
        danh_sach: ketQua
    });
});

/*
 * API lấy lịch sử tin nhắn riêng giữa 2 người.
 * Ví dụ:
 * http://localhost:3000/lich-su-rieng/HS-1/HS-2
 */
ungDung.get("/lich-su-rieng/:maNguoiA/:maNguoiB", function (req, res) {
    const maNguoiA = hamChuanHoaChuoi(req.params.maNguoiA);
    const maNguoiB = hamChuanHoaChuoi(req.params.maNguoiB);

    const danhSachTinNhan = hamDocLichSuTinNhanTuFile();

    const ketQua = danhSachTinNhan.filter(function (tinNhan) {
        const aGuiB = tinNhan.ma_nguoi_gui === maNguoiA
            && tinNhan.ma_nguoi_nhan === maNguoiB;

        const bGuiA = tinNhan.ma_nguoi_gui === maNguoiB
            && tinNhan.ma_nguoi_nhan === maNguoiA;

        return tinNhan.loai_tin_nhan === "rieng" && (aGuiB || bGuiA);
    });

    res.json({
        thanh_cong: true,
        loai: "rieng",
        ma_nguoi_a: maNguoiA,
        ma_nguoi_b: maNguoiB,
        so_luong: ketQua.length,
        danh_sach: ketQua
    });
});

/*
 * API xóa toàn bộ lịch sử tin nhắn.
 * Dùng khi test demo.
 * Mở trình duyệt:
 * http://localhost:3000/xoa-lich-su-tin-nhan
 */
ungDung.get("/xoa-lich-su-tin-nhan", function (req, res) {
    hamGhiLichSuTinNhanRaFile([]);

    /*
     * Xóa cả dữ liệu RAM.
     */
    lichSuTinNhan.length = 0;

    res.json({
        thanh_cong: true,
        thong_bao: "Đã xóa toàn bộ lịch sử tin nhắn."
    });
});

/*
 * Hàm tạo thời gian hiện tại dạng timestamp.
 */
function hamLayThoiGianHienTai() {
    return new Date().toISOString();
}

/*
 * Hàm chuẩn hóa chuỗi để tránh null/undefined.
 */
function hamChuanHoaChuoi(giaTri, macDinh = "") {
    if (giaTri === undefined || giaTri === null) {
        return macDinh;
    }

    return String(giaTri).trim();
}

/*
 * Hàm kiểm tra dữ liệu người dùng khi kết nối.
 */
function hamKiemTraDuLieuNguoiDung(duLieu) {
    const maNguoiDung = hamChuanHoaChuoi(duLieu.ma_nguoi_dung);
    const tenHienThi = hamChuanHoaChuoi(duLieu.ten_hien_thi);

    if (maNguoiDung.length < 3) {
        return {
            hop_le: false,
            thong_bao: "Mã người dùng không hợp lệ."
        };
    }

    if (tenHienThi.length < 1) {
        return {
            hop_le: false,
            thong_bao: "Tên hiển thị không hợp lệ."
        };
    }

    return {
        hop_le: true,
        ma_nguoi_dung: maNguoiDung,
        ten_hien_thi: tenHienThi
    };
}

/*
 * Hàm kiểm tra nội dung tin nhắn.
 */
function hamKiemTraTinNhan(noiDung) {
    const noiDungTinNhan = hamChuanHoaChuoi(noiDung);

    if (noiDungTinNhan.length < 1) {
        return {
            hop_le: false,
            thong_bao: "Tin nhắn không được để trống."
        };
    }

    if (noiDungTinNhan.length > 500) {
        return {
            hop_le: false,
            thong_bao: "Tin nhắn nên dưới 500 ký tự."
        };
    }

    return {
        hop_le: true,
        noi_dung: noiDungTinNhan
    };
}

/*
 * Hàm gửi danh sách online tới tất cả client.
 */
function hamPhatDanhSachOnline() {
    io.emit("cap_nhat_danh_sach_online", {
        so_luong: danhSachNguoiDungOnline.size,
        danh_sach: Array.from(danhSachNguoiDungOnline.values())
    });
}

/*
 * Hàm lưu tin nhắn vào RAM.
 */
function hamLuuTinNhan(tinNhan) {
    /*
     * Lưu vào RAM để server đang chạy truy xuất nhanh.
     */
    lichSuTinNhan.push(tinNhan);

    /*
     * Chỉ giữ 300 tin gần nhất trong RAM.
     */
    if (lichSuTinNhan.length > 300) {
        lichSuTinNhan.shift();
    }

    /*
     * Lưu thêm vào file JSON để khi tắt server mở lại vẫn còn lịch sử.
     */
    const danhSachTinNhanFile = hamDocLichSuTinNhanTuFile();

    danhSachTinNhanFile.push(tinNhan);

    /*
     * Giữ tối đa 1000 tin gần nhất trong file.
     */
    const danhSachGon = danhSachTinNhanFile.slice(-1000);

    hamGhiLichSuTinNhanRaFile(danhSachGon);
}

/*
 * Khu vực xử lý Socket.io realtime.
 */
io.on("connection", function (socket) {
    console.log("Có client kết nối:", socket.id);

    /*
     * Client Android gửi sự kiện này sau khi kết nối socket thành công.
     * Dữ liệu cần có:
     * {
     *   ma_nguoi_dung: "HS-xxx",
     *   ten_hien_thi: "La nho"
     * }
     */
    socket.on("ket_noi_nguoi_dung", function (duLieu) {
        const ketQua = hamKiemTraDuLieuNguoiDung(duLieu || {});

        if (!ketQua.hop_le) {
            socket.emit("loi_chat", {
                thong_bao: ketQua.thong_bao
            });
            return;
        }

        const thongTinNguoiDung = {
            ma_nguoi_dung: ketQua.ma_nguoi_dung,
            ten_hien_thi: ketQua.ten_hien_thi,
            socket_id: socket.id,
            thoi_gian_online: hamLayThoiGianHienTai()
        };

        /*
         * Lưu người dùng vào danh sách online.
         */
        danhSachNguoiDungOnline.set(ketQua.ma_nguoi_dung, thongTinNguoiDung);
        bangSocketNguoiDung.set(socket.id, ketQua.ma_nguoi_dung);

        /*
         * Cho mỗi người dùng vào một phòng riêng theo mã người dùng.
         * Chat 1-1 sẽ gửi tới phòng này.
         */
        socket.join("nguoi_dung_" + ketQua.ma_nguoi_dung);

        /*
         * Báo lại cho chính client biết đã kết nối thành công.
         */
        socket.emit("ket_noi_thanh_cong", {
            thong_bao: "Kết nối realtime thành công.",
            thong_tin: thongTinNguoiDung
        });

        /*
         * Phát danh sách online cho toàn bộ client.
         */
        hamPhatDanhSachOnline();

        console.log("Người dùng online:", ketQua.ten_hien_thi);
    });

    /*
     * Người dùng vào phòng nhóm.
     * Ví dụ:
     * {
     *   ma_phong: "phong_chung",
     *   ten_phong: "Phòng chung Healing"
     * }
     */
    socket.on("vao_phong_nhom", function (duLieu) {
        const maPhong = hamChuanHoaChuoi(duLieu && duLieu.ma_phong, "phong_chung");
        const tenPhong = hamChuanHoaChuoi(duLieu && duLieu.ten_phong, "Phòng chung");

        socket.join(maPhong);

        socket.emit("vao_phong_nhom_thanh_cong", {
            ma_phong: maPhong,
            ten_phong: tenPhong,
            thong_bao: "Đã vào phòng nhóm."
        });

        socket.to(maPhong).emit("thanh_vien_vao_phong", {
            ma_phong: maPhong,
            socket_id: socket.id,
            thoi_gian: hamLayThoiGianHienTai()
        });

        console.log(socket.id, "vào phòng", maPhong);
    });

    /*
     * Người dùng rời phòng nhóm.
     */
    socket.on("roi_phong_nhom", function (duLieu) {
        const maPhong = hamChuanHoaChuoi(duLieu && duLieu.ma_phong, "phong_chung");

        socket.leave(maPhong);

        socket.emit("roi_phong_nhom_thanh_cong", {
            ma_phong: maPhong,
            thong_bao: "Đã rời phòng nhóm."
        });

        console.log(socket.id, "rời phòng", maPhong);
    });

    /*
     * Gửi tin nhắn nhóm.
     * Dữ liệu:
     * {
     *   ma_phong: "phong_chung",
     *   ma_nguoi_gui: "HS-xxx",
     *   ten_nguoi_gui: "La nho",
     *   noi_dung: "Xin chào"
     * }
     */
    socket.on("gui_tin_nhan_nhom", function (duLieu) {
        const kiemTra = hamKiemTraTinNhan(duLieu && duLieu.noi_dung);

        if (!kiemTra.hop_le) {
            socket.emit("loi_chat", {
                thong_bao: kiemTra.thong_bao
            });
            return;
        }

        const maPhong = hamChuanHoaChuoi(duLieu.ma_phong, "phong_chung");

        const tinNhan = {
            loai_tin_nhan: "nhom",
            ma_phong: maPhong,
            ma_nguoi_gui: hamChuanHoaChuoi(duLieu.ma_nguoi_gui),
            ten_nguoi_gui: hamChuanHoaChuoi(duLieu.ten_nguoi_gui, "Người chữa lành"),
            noi_dung: kiemTra.noi_dung,
            thoi_gian: hamLayThoiGianHienTai()
        };

        hamLuuTinNhan(tinNhan);

        /*
         * Gửi tin nhắn tới toàn bộ người trong phòng, bao gồm cả người gửi.
         */
        io.to(maPhong).emit("nhan_tin_nhan_nhom", tinNhan);

        console.log("Tin nhóm:", tinNhan);
    });

    /*
     * Gửi tin nhắn riêng 1-1.
     * Dữ liệu:
     * {
     *   ma_nguoi_gui: "HS-1",
     *   ten_nguoi_gui: "La nho",
     *   ma_nguoi_nhan: "HS-2",
     *   noi_dung: "Chào bạn"
     * }
     */
    socket.on("gui_tin_nhan_rieng", function (duLieu) {
        const kiemTra = hamKiemTraTinNhan(duLieu && duLieu.noi_dung);

        if (!kiemTra.hop_le) {
            socket.emit("loi_chat", {
                thong_bao: kiemTra.thong_bao
            });
            return;
        }

        const maNguoiGui = hamChuanHoaChuoi(duLieu.ma_nguoi_gui);
        const maNguoiNhan = hamChuanHoaChuoi(duLieu.ma_nguoi_nhan);

        if (maNguoiGui.length < 1 || maNguoiNhan.length < 1) {
            socket.emit("loi_chat", {
                thong_bao: "Thiếu mã người gửi hoặc người nhận."
            });
            return;
        }

        const tinNhan = {
            loai_tin_nhan: "rieng",
            ma_nguoi_gui: maNguoiGui,
            ten_nguoi_gui: hamChuanHoaChuoi(duLieu.ten_nguoi_gui, "Người chữa lành"),
            ma_nguoi_nhan: maNguoiNhan,
            noi_dung: kiemTra.noi_dung,
            thoi_gian: hamLayThoiGianHienTai()
        };

        hamLuuTinNhan(tinNhan);

        /*
         * Gửi tới phòng riêng của người nhận.
         */
        io.to("nguoi_dung_" + maNguoiNhan).emit("nhan_tin_nhan_rieng", tinNhan);

        /*
         * Gửi lại cho người gửi để đồng bộ giao diện.
         */
        socket.emit("nhan_tin_nhan_rieng", tinNhan);

        console.log("Tin riêng:", tinNhan);
    });

    /*
     * Sự kiện đang gõ.
     * Dùng để Android sau này hiện: "Mây nhỏ đang nhập..."
     */
    socket.on("dang_go", function (duLieu) {
        const maPhong = hamChuanHoaChuoi(duLieu && duLieu.ma_phong, "");
        const tenNguoiGui = hamChuanHoaChuoi(duLieu && duLieu.ten_nguoi_gui, "Ai đó");

        if (maPhong.length > 0) {
            socket.to(maPhong).emit("co_nguoi_dang_go", {
                ma_phong: maPhong,
                ten_nguoi_gui: tenNguoiGui
            });
        }
    });

    /*
     * Khi client mất kết nối.
     */
    socket.on("disconnect", function () {
        const maNguoiDung = bangSocketNguoiDung.get(socket.id);

        if (maNguoiDung) {
            const thongTin = danhSachNguoiDungOnline.get(maNguoiDung);

            danhSachNguoiDungOnline.delete(maNguoiDung);
            bangSocketNguoiDung.delete(socket.id);

            console.log("Người dùng offline:", thongTin ? thongTin.ten_hien_thi : maNguoiDung);

            hamPhatDanhSachOnline();
        } else {
            console.log("Client ngắt kết nối:", socket.id);
        }
    });
});

/*
 * Khởi chạy server.
 */
mayChuHttp.listen(CONG_SERVER, "0.0.0.0", function () {
    console.log("Healing Station Socket.io server đang chạy.");
    console.log("Cổng:", CONG_SERVER);
    console.log("Mở trình duyệt kiểm tra: http://localhost:" + CONG_SERVER);
});