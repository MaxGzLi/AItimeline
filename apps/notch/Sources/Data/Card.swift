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
    let topicId: String?
    let sourceTitle: String?
    let sourceUrl: String?
    let conceptIds: [String]
    let hook: String?
    let keyTakeaway: String?
    let shortBody: String?
    let estimatedReadMinutes: Int?
    let reviewPrompt: String?
    let sections: [Section]

    /// 时间在解卡时就算成 Date 存下来。界面每帧都要问「到期没有」,
    /// 不能每次现建一个 formatter 现解字符串。
    let savedAt: Date?
    let reviewDueAt: Date?

    private enum CodingKeys: String, CodingKey {
        case id, title, summary, topicId, sourceTitle, sourceUrl, savedAt, conceptIds
        case reviewDueAt, hook, keyTakeaway, shortBody, estimatedReadMinutes
        case reviewPrompt, sections
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(String.self, forKey: .id)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? ""
        summary = try container.decodeIfPresent(String.self, forKey: .summary) ?? ""
        topicId = try container.decodeIfPresent(String.self, forKey: .topicId)
        sourceTitle = try container.decodeIfPresent(String.self, forKey: .sourceTitle)
        sourceUrl = try container.decodeIfPresent(String.self, forKey: .sourceUrl)
        conceptIds = try container.decodeIfPresent([String].self, forKey: .conceptIds) ?? []
        hook = try container.decodeIfPresent(String.self, forKey: .hook)
        keyTakeaway = try container.decodeIfPresent(String.self, forKey: .keyTakeaway)
        shortBody = try container.decodeIfPresent(String.self, forKey: .shortBody)
        estimatedReadMinutes = try container.decodeIfPresent(Int.self, forKey: .estimatedReadMinutes)
        reviewPrompt = try container.decodeIfPresent(String.self, forKey: .reviewPrompt)
        sections = try container.decodeIfPresent([Section].self, forKey: .sections) ?? []

        savedAt = Card.parseTime(try container.decodeIfPresent(String.self, forKey: .savedAt))
        reviewDueAt = Card.parseTime(try container.decodeIfPresent(String.self, forKey: .reviewDueAt))
    }

    /// 接口发的是 `2026-07-05T13:14:49.000Z` 这种**带毫秒**的时间。
    /// `ISO8601DateFormatter` 默认不认毫秒,直接返回 nil —— 之前「该复习」
    /// 一次都没亮过就是栽在这儿。所以先按带毫秒解,不成再按不带毫秒解。
    private static func parseTime(_ value: String?) -> Date? {
        guard let value else { return nil }

        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        return withFraction.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    // MARK: - 正文

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

    /// 悬停档只给一句结论。有要点用要点,没有才退回标题。
    var lead: String {
        let takeaway = keyTakeaway ?? ""

        return takeaway.isEmpty ? displayTitle : takeaway
    }

    /// 概念名在库里是 `source_grounded_answer` 这种下划线串,显示前换成空格。
    var conceptNames: [String] {
        conceptIds.map { $0.replacingOccurrences(of: "_", with: " ") }
    }

    // MARK: - 来源

    /// 来源方块里那个字母:域名的二级域首字母,取不到就用来源名首字。
    ///
    /// 域名首字不是字母就跳过(本机来源是 `127.0.0.1`,取出来是个「1」,
    /// 方块里放个数字既认不出来源、又和右边那个真数字撞脸)。
    var sourceLetter: String? {
        if let host = sourceUrl.flatMap({ URL(string: $0)?.host }) {
            let stem = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host

            if let first = stem.first, first.isLetter {
                return String(first).uppercased()
            }
        }

        if let first = sourceTitle?.trimmingCharacters(in: .whitespaces).first {
            return String(first).uppercased()
        }

        return nil
    }

    // MARK: - 时间

    /// 这张卡今天该复习了没有。到期时间早于此刻就算到期。
    var isReviewDue: Bool {
        guard let reviewDueAt else { return false }

        return reviewDueAt <= Date()
    }

    /// 「为什么现在给你看」—— 悬停档右翼那一小段。
    var timelinessLabel: String {
        if isReviewDue { return "该复习" }

        if let savedAt, Date().timeIntervalSince(savedAt) < 86_400 { return "刚存下" }

        guard let reviewDueAt else { return "" }

        let days = Int(ceil(reviewDueAt.timeIntervalSinceNow / 86_400))

        return days <= 1 ? "明天" : "\(days) 天后"
    }

    /// 面板肩栏右翼那一枚:到期了是可点的动作态,没到期是纯状态。
    var reviewLabel: String {
        if isReviewDue { return "该复习" }

        guard let reviewDueAt else { return "" }

        let days = Int(ceil(reviewDueAt.timeIntervalSinceNow / 86_400))

        return days <= 1 ? "明天复习" : "\(days) 天后复习"
    }

    /// 面板肩栏左翼:什么时候存下的。
    var savedAgoLabel: String? {
        guard let savedAt else { return nil }

        let seconds = Date().timeIntervalSince(savedAt)

        if seconds < 3_600 { return "刚存下" }
        if seconds < 86_400 { return "\(Int(seconds / 3_600)) 小时前存" }

        return "\(Int(seconds / 86_400)) 天前存"
    }
}

struct CardFeed: Decodable {
    let cards: [Card]
}
