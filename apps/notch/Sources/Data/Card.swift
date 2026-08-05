import Foundation

/// 一张知识卡。字段和本机接口 `GET /api/inject/cards` 一一对应
/// (`apps/api/src/domains/injectFeed.mjs` 里的 `toInjectCard`)。
/// 除了 id / title / summary,其余都是可选 —— 接口那边也是按需带上的,
/// 缺字段不能让整批卡解不出来。
struct Card: Decodable, Identifiable, Equatable {
    struct Section: Decodable, Equatable {
        let title: String
        let body: String
    }

    let id: String
    let title: String
    let summary: String
    let sourceTitle: String?
    let sourceUrl: String?
    let savedAt: String?
    let conceptIds: [String]
    let reviewDueAt: String?
    let hook: String?
    let keyTakeaway: String?
    let shortBody: String?
    let estimatedReadMinutes: Int?
    let reviewPrompt: String?
    let sections: [Section]

    private enum CodingKeys: String, CodingKey {
        case id, title, summary, sourceTitle, sourceUrl, savedAt, conceptIds
        case reviewDueAt, hook, keyTakeaway, shortBody, estimatedReadMinutes
        case reviewPrompt, sections
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(String.self, forKey: .id)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? ""
        summary = try container.decodeIfPresent(String.self, forKey: .summary) ?? ""
        sourceTitle = try container.decodeIfPresent(String.self, forKey: .sourceTitle)
        sourceUrl = try container.decodeIfPresent(String.self, forKey: .sourceUrl)
        savedAt = try container.decodeIfPresent(String.self, forKey: .savedAt)
        conceptIds = try container.decodeIfPresent([String].self, forKey: .conceptIds) ?? []
        reviewDueAt = try container.decodeIfPresent(String.self, forKey: .reviewDueAt)
        hook = try container.decodeIfPresent(String.self, forKey: .hook)
        keyTakeaway = try container.decodeIfPresent(String.self, forKey: .keyTakeaway)
        shortBody = try container.decodeIfPresent(String.self, forKey: .shortBody)
        estimatedReadMinutes = try container.decodeIfPresent(Int.self, forKey: .estimatedReadMinutes)
        reviewPrompt = try container.decodeIfPresent(String.self, forKey: .reviewPrompt)
        sections = try container.decodeIfPresent([Section].self, forKey: .sections) ?? []
    }

    /// 正文那一段。`shortBody` 空了退回 `summary`。
    private var fullBody: String {
        let short = shortBody ?? ""

        return short.isEmpty ? summary : short
    }

    /// 面板上的大标题。
    ///
    /// 接口给的 `title` 是截断过的(一百字左右加省略号),而正文常常就是同一句的全文。
    /// 两句一起摆出来,面板上就成了同一句话说两遍、后一遍才说完。所以标题被截断、
    /// 正文又正好是它的全文时,直接拿全文当标题。
    var displayTitle: String {
        guard let stem = truncatedStem, fullBody.hasPrefix(stem) else { return title }

        return fullBody
    }

    /// 正文段。已经被当成标题印出去了就不再印一遍。
    var displayBody: String {
        displayTitle == fullBody ? "" : fullBody
    }

    /// 标题去掉尾巴那个省略号剩下的部分;标题没被截断就是 nil。
    private var truncatedStem: String? {
        for tail in ["...", "…"] where title.hasSuffix(tail) {
            return String(title.dropLast(tail.count))
        }

        return nil
    }

    /// 这张卡今天该复习了没有。到期时间早于此刻就算到期。
    var isReviewDue: Bool {
        guard let reviewDueAt, let due = ISO8601DateFormatter().date(from: reviewDueAt) else {
            return false
        }

        return due <= Date()
    }
}

struct CardFeed: Decodable {
    let cards: [Card]
}
