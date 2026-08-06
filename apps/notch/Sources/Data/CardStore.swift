import Foundation
import SwiftUI

/// 从本机接口拉知识卡。
///
/// 拉不到的时候**保留上一批** —— 知识卡不会一分钟就过期,拿旧的看比空着强。
/// 接口挂了只把 `isOffline` 打开,让界面上出个提示,不清空。
@MainActor
final class CardStore: ObservableObject {
    static let shared = CardStore()

    @Published private(set) var cards: [Card] = []
    @Published private(set) var isOffline = false
    /// 一次都还没拉回来。第一次拉回来之前界面要显示「加载中」而不是「没有卡」。
    @Published private(set) var hasLoadedOnce = false

    @Published var index = 0
    @Published var page = 0

    private let endpoint = URL(string: "http://127.0.0.1:8787/api/inject/cards")!
    private var timer: Timer?

    private init() {}

    var current: Card? {
        guard cards.indices.contains(index) else { return nil }

        return cards[index]
    }

    var dueCount: Int {
        cards.filter(\.isReviewDue).count
    }

    func start() {
        Task { await refresh() }

        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
    }

    func refresh() async {
        do {
            var request = URLRequest(url: endpoint)
            request.timeoutInterval = 4

            let (data, response) = try await URLSession.shared.data(for: request)

            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                isOffline = true
                hasLoadedOnce = true
                return
            }

            let feed = try JSONDecoder().decode(CardFeed.self, from: data)

            cards = feed.cards
            isOffline = false
            hasLoadedOnce = true

            if index >= cards.count {
                index = 0
                page = 0
            }
        } catch {
            isOffline = true
            hasLoadedOnce = true
        }
    }

    func next() {
        guard !cards.isEmpty else { return }

        index = (index + 1) % cards.count
        page = 0
    }

    func previous() {
        guard !cards.isEmpty else { return }

        index = (index - 1 + cards.count) % cards.count
        page = 0
    }

    /// 「标记已复习」走复习排期接口,**不是**行为信号接口。
    ///
    /// 这两个接口长得像,管的事完全不同:`/api/signals` 只记「用户干过什么」,
    /// 记完到期时间一动不动 —— 之前这里发的就是它,所以每按一次都记下了一笔,
    /// 卡的到期时间却永远钉在原地,条上那个琥珀色的数字自然一直消不掉。
    /// 真正把到期时间往后推的是这一个(和网页端用的是同一个,见 `apps/web/src/App.tsx`
    /// 的 `completeReview`):间隔 1 天推到 3 天,并写上 `lastReviewedAt`。
    /// 它自己会记一条 reviewed 信号(`apps/api/src/domains/review.mjs`),
    /// 所以这里**不能**再补发一条,否则同一次复习记两遍账。
    ///
    /// 只对到期的卡调。卡上带 `reviewDueAt` 等价于「服务端有这张卡的复习记录、而且已经到期」,
    /// 没有记录的卡调过去是 404。
    func markReviewed(_ card: Card) async -> Bool {
        guard card.isReviewDue, let endpoint = Self.reviewEndpoint(card.id) else { return false }

        let now = Date()
        let payload: [String: Any] = [
            "reviewedAt": ISO8601DateFormatter().string(from: now),
            "grade": "remembered",
            // 防连按:同一张卡同一秒按两下算同一次,不会把间隔连推两级。
            "reviewEventId": "\(card.id)-\(Int(now.timeIntervalSince1970))"
        ]

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 4
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0

            guard code == 200 || code == 201 else { return false }

            await refresh()

            return true
        } catch {
            return false
        }
    }

    /// 卡号是拼进路径里的,得逐段转义。用未保留字符集,不能用 `.urlPathAllowed` ——
    /// 那一档放行斜杠,卡号里真出现斜杠就会把路径拆成两段。
    private static func reviewEndpoint(_ postId: String) -> URL? {
        let unreserved = CharacterSet(charactersIn: "-._~").union(.alphanumerics)

        guard let escaped = postId.addingPercentEncoding(withAllowedCharacters: unreserved) else {
            return nil
        }

        return URL(string: "http://127.0.0.1:8787/api/review/\(escaped)/complete")
    }
}
