import AppKit
import Foundation
import UniformTypeIdentifiers
import Vision

/// 收集架上的一条。
struct ShelfItem: Identifiable, Codable, Equatable {
    enum Kind: String, Codable {
        case link
        case text
        case image
    }

    let id: String
    var kind: Kind
    /// 主行:链接给标题或域名,文字给头一句,截图给「截图」。
    var title: String
    /// 副行:这条是怎么被存的、存成了什么。不能骗人 —— 笔记就写笔记。
    var detail: String
    var url: String?
    var text: String?
    /// 截图落盘的位置。删掉这条时连着删。
    var imagePath: String?
    var addedAt: Date
    /// 给人看的一句话:「正在存…」「排队中」「已成卡」「来源没过关」。
    var status: String
    var failed: Bool
    /// 重试按钮给不给。**只有「没送出去」才给** ——
    /// 接口那边一旦给了终局(来源没过关、抓不到正文),同一个网址再发一次只会回一句
    /// 「这个我知道」,什么都不会发生。给个按不动的按钮比不给更糟。
    /// 老的 shelf.json 里没有这个字段,所以是可选的。
    var canRetry: Bool?
}

/// 拖进刘海的东西存哪儿、怎么发给本机 AITimeline。
///
/// 三条通路,各自不同,界面上必须写清楚是哪一条:
/// - **链接** → `POST /api/captures/source`,走完整通路,出的是带引文的真知识卡。
///   `intakeKind: browser_share` 是给「用户亲手剪的」准备的优待档。
/// - **纯文字** → `POST /api/notes`,出的是**笔记**,不过来源质量门禁、不过引文接地检查。
/// - **截图** → 本机 Vision 认出字,再当文字走上面那条。
///   接口只收 JSON、没有图片上传口,模型也不在客户端这边,所以今天只能到这一步。
@MainActor
final class ShelfStore: ObservableObject {
    static let shared = ShelfStore()

    @Published private(set) var items: [ShelfItem] = []
    /// 有东西正悬在刘海上。拖拽期间不许自动收起,不然东西掉一半面板没了。
    @Published var isTargeted = false

    static let acceptedTypes: [UTType] = [.fileURL, .url, .image, .utf8PlainText, .plainText, .text]

    private let base = URL(string: "http://127.0.0.1:8787")!
    private let store: URL
    private let imageDirectory: URL

    private init() {
        let support = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("AITimelineNotch", isDirectory: true)

        store = support.appendingPathComponent("shelf.json")
        imageDirectory = support.appendingPathComponent("ShelfImages", isDirectory: true)

        try? FileManager.default.createDirectory(at: imageDirectory, withIntermediateDirectories: true)

        load()
    }

    // MARK: - 收下

    /// 返回 true 表示这批东西我们接了。真正的解析在后台做,不能挡住拖放动画。
    func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        guard !providers.isEmpty else { return false }

        Task {
            for provider in providers {
                if let item = await Self.extract(provider, into: imageDirectory) {
                    add(item)
                }
            }
        }

        return true
    }

    private func add(_ item: ShelfItem) {
        // 同一个链接拖两次不重复入架,把老的那条挪到最前面就行。
        if let key = item.url, let existing = items.firstIndex(where: { $0.url == key }) {
            var moved = items.remove(at: existing)
            moved.addedAt = Date()
            items.insert(moved, at: 0)
            persist()
            return
        }

        items.insert(item, at: 0)
        persist()

        Task { await send(item.id) }
    }

    func remove(_ id: String) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }

        let item = items.remove(at: index)

        // 只删我们自己落的那份,拖进来的原文件不动。
        if let path = item.imagePath, path.hasPrefix(imageDirectory.path) {
            try? FileManager.default.removeItem(atPath: path)
        }

        persist()
    }

    /// 清掉「已经有结果的」:成了的、以及接口给了终局的。正在路上的留着。
    func clearSaved() {
        for item in items where item.status != Self.sending && item.canRetry != true {
            remove(item.id)
        }
    }

    // MARK: - 发出去

    static let sending = "正在存…"

    private func send(_ id: String) async {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }

        let item = items[index]

        do {
            let status: String

            if let url = item.url {
                _ = try await post("/api/captures/source", [
                    "url": url,
                    "intakeKind": "browser_share"
                ])
                // 催一把,不然要等后台那一轮,用户看不到反馈。
                _ = try? await post("/api/curation/run", [:])
                status = "排队中"
            } else if let text = item.text, !text.isEmpty {
                _ = try await post("/api/notes", ["text": text, "kind": "idea"])
                status = "已成笔记"
            } else {
                update(id) { $0.status = "没认出内容"; $0.failed = true; $0.canRetry = false }
                return
            }

            update(id) { $0.status = status; $0.failed = false; $0.canRetry = false }
        } catch {
            update(id) { $0.status = "AITimeline 没在跑"; $0.failed = true; $0.canRetry = true }
        }
    }

    /// 手动重试。只有「压根没送出去」才走到这儿(见 `canRetry`)。
    func retry(_ id: String) {
        update(id) { $0.status = Self.sending; $0.failed = false }

        Task { await send(id) }
    }

    /// 存进去的链接后来怎么样了。只在收集面露脸的时候问,不常驻轮询。
    ///
    /// 接口返回的形状是 `{ records: [{ status, candidate: { source: { url } } }] }` ——
    /// 网址埋在两层里面,别在顶层找。
    func refreshStatuses() async {
        guard items.contains(where: { $0.kind == .link && $0.canRetry != true }) else { return }

        guard let data = try? await get("/api/source-candidates"),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let records = payload["records"] as? [[String: Any]] else {
            return
        }

        for record in records {
            guard let status = record["status"] as? String,
                  let candidate = record["candidate"] as? [String: Any],
                  let source = candidate["source"] as? [String: Any],
                  let url = source["url"] as? String,
                  let index = items.firstIndex(where: { $0.url == url }) else {
                continue
            }

            let (label, bad) = Self.label(for: status)

            items[index].status = label
            items[index].failed = bad
            // 接口给的都是终局,再发一次也不会重来 —— 收起重试。
            items[index].canRetry = false
        }

        persist()
    }

    /// 把接口的状态翻成人话。坏消息要说清楚是哪种坏,不然用户不知道该换个网址还是等一等。
    private static func label(for status: String) -> (String, Bool) {
        switch status {
        case "pending": return ("排队中", false)
        case "queued": return ("正在转化", false)
        case "imported": return ("已成卡", false)
        case "unreachable": return ("抓不到正文", true)
        case "rejected_source": return ("来源没过关", true)
        case "skipped": return ("没转化成", true)
        case "dismissed": return ("被丢掉了", true)
        default: return (status, false)
        }
    }

    private func update(_ id: String, _ change: (inout ShelfItem) -> Void) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }

        change(&items[index])
        persist()
    }

    // MARK: - 本机接口

    @discardableResult
    private func post(_ path: String, _ body: [String: Any]) async throws -> Data {
        var request = URLRequest(url: base.appendingPathComponent(path))

        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0

        guard (200..<300).contains(code) else {
            throw URLError(.badServerResponse)
        }

        return data
    }

    private func get(_ path: String) async throws -> Data {
        var request = URLRequest(url: base.appendingPathComponent(path))

        request.timeoutInterval = 6

        let (data, _) = try await URLSession.shared.data(for: request)

        return data
    }

    // MARK: - 落盘

    private func load() {
        guard let data = try? Data(contentsOf: store),
              let saved = try? JSONDecoder().decode([ShelfItem].self, from: data) else {
            return
        }

        items = saved
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(items) else { return }

        try? data.write(to: store, options: .atomic)
    }
}
