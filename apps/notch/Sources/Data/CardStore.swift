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
    private let signalsEndpoint = URL(string: "http://127.0.0.1:8787/api/signals")!
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

    /// 「标记已复习」回传一条行为信号,和浏览器插件走的是同一个接口、同一套字段
    /// (`apps/notch-extension/index.js` 的 `sendOpenSignal`),只是 `reviewed` 为真。
    /// 接口那边按整条信号的内容做去重,所以同一张卡先看后标不会被当成重复丢掉。
    func markReviewed(_ card: Card) async -> Bool {
        guard let topicId = card.topicId, !topicId.isEmpty, !card.conceptIds.isEmpty else {
            return false
        }

        let now = ISO8601DateFormatter().string(from: Date())
        let signal: [String: Any] = [
            "postId": card.id,
            "topicId": topicId,
            "conceptIds": card.conceptIds,
            "impression": true,
            "dwellTimeMs": 9_000,
            "openedThread": true,
            "liked": false,
            "saved": false,
            "askedQuestion": false,
            "reviewed": true,
            "skippedQuickly": false,
            "createdAt": now
        ]
        let payload: [String: Any] = [
            "generatedAt": now,
            "signal": signal,
            "sourceCandidates": []
        ]

        var request = URLRequest(url: signalsEndpoint)
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
}
