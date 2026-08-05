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
}
