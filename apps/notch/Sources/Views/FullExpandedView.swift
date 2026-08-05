import AppKit
import SwiftUI

/// 小节在阅读栏里的纵向位置。侧栏那份目录靠它知道现在读到哪一节。
struct SectionOffsetKey: PreferenceKey {
    static let defaultValue: [Int: CGFloat] = [:]

    static func reduce(value: inout [Int: CGFloat], nextValue: () -> [Int: CGFloat]) {
        value.merge(nextValue()) { _, new in new }
    }
}

/// 半屏阅读面板:面板 900×520。
///
/// 这一档才是完整一张卡。版面账:37(肩栏)+ 12 + 430(两栏)+ 41(底通栏)= 520。
///
/// **为什么要分两栏**:一段文字横穿 836 点,眼睛读到行尾就找不回行首了。
/// 原版 658 宽的面板也是切成三栏的,从来不让一段文字排满内容宽。
/// 切完之后最长一行是 544,一行四十个汉字上下,这才叫留了空档。
struct FullExpandedView: View {
    @EnvironmentObject private var appState: AppState
    @ObservedObject private var store = CardStore.shared

    @State private var sectionOffsets: [Int: CGFloat] = [:]
    @State private var marked = false

    private let sidePadding: CGFloat = 32
    private let columnGap: CGFloat = 20
    private let sideWidth: CGFloat = 236
    /// 挂式缩进:正文文字统一钉在离栏左边 15 的地方,锚点竖条挂在 0。
    /// 用户说的「没空档」,一半是没有一条竖直的对齐线可看,眼睛无处落脚。
    private let hang: CGFloat = 15

    var body: some View {
        VStack(spacing: 0) {
            if appState.contentTopInset > 0 {
                shoulder
                    .frame(height: appState.contentTopInset)
                    .clipped()
            } else {
                flatShoulder
                    .padding(.horizontal, sidePadding)
                    .padding(.top, 10)
            }

            if let card = store.current {
                columns(card)
                    .padding(.horizontal, sidePadding)
                    .padding(.top, 12)
                    .frame(maxHeight: .infinity, alignment: .top)

                footer(card)
                    .padding(.horizontal, sidePadding)
            } else {
                empty
            }
        }
        .onChange(of: store.index) { _, _ in
            marked = false
        }
    }

    // MARK: - 肩栏(装在让开刘海的那条带子里)

    private var shoulder: some View {
        let available = appState.currentSize.width - 80
        let trailing: CGFloat = 200
        let leading = max(0, available - appState.shoulderGap - trailing)

        return HStack(spacing: 0) {
            shoulderLeading
                .frame(width: leading, alignment: .leading)

            Spacer(minLength: appState.shoulderGap)

            shoulderTrailing
                .frame(width: trailing, alignment: .trailing)
        }
        .padding(.horizontal, 40)
        .padding(.top, 2)
        .frame(maxHeight: .infinity, alignment: .center)
    }

    @ViewBuilder
    private var shoulderLeading: some View {
        if let card = store.current {
            HStack(spacing: 8) {
                SourceTile(letter: card.sourceLetter, size: 18)

                Text(card.sourceTitle ?? "")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(NotchInk.meta)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: 300, alignment: .leading)

                if let saved = card.savedAgoLabel {
                    Text("·")
                        .font(.system(size: 10))
                        .foregroundStyle(.white.opacity(0.16))

                    Text(saved)
                        .font(.system(size: 10, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(NotchInk.faint)
                }

                Spacer(minLength: 0)
            }
        }
    }

    @ViewBuilder
    private var shoulderTrailing: some View {
        if let card = store.current {
            HStack(spacing: 12) {
                Spacer(minLength: 0)

                reviewChip(card)

                if let minutes = card.estimatedReadMinutes {
                    Text("\(minutes) 分钟")
                        .font(.system(size: 10, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(.white.opacity(0.34))
                }

                Text("\(store.index + 1)/\(store.cards.count)")
                    .font(.system(size: 10, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(NotchInk.ghost)
            }
        }
    }

    /// 到期了才用实心琥珀(可点的动作态),没到期是透明胶囊(纯状态)。
    /// 两种态长得不一样,标签才不会一锅乱炖。
    @ViewBuilder
    private func reviewChip(_ card: Card) -> some View {
        if card.isReviewDue {
            Text(card.reviewLabel)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.black)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(RoundedRectangle(cornerRadius: 4).fill(NotchAccent.amber))
        } else if !card.reviewLabel.isEmpty {
            Text(card.reviewLabel)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.white.opacity(0.72))
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Capsule().fill(.white.opacity(0.10)))
        }
    }

    /// 没刘海的机器:肩栏退化成内容上方的一整行,两翼不硬撑。
    private var flatShoulder: some View {
        HStack(spacing: 12) {
            shoulderLeading
            Spacer(minLength: 12)
            shoulderTrailing
        }
        .frame(height: 20)
    }

    // MARK: - 两栏

    private func columns(_ card: Card) -> some View {
        let total = appState.currentSize.width - sidePadding * 2
        let reading = max(320, total - columnGap * 2 - 1 - sideWidth)

        return ScrollViewReader { proxy in
            HStack(spacing: 0) {
                readingColumn(card)
                    .frame(width: reading)

                Spacer()
                    .frame(width: columnGap)

                Rectangle()
                    .fill(NotchSurface.hairline)
                    .frame(width: 1)
                    .padding(.vertical, 4)

                Spacer()
                    .frame(width: columnGap)

                sideColumn(card, proxy: proxy)
                    .frame(width: sideWidth)
            }
        }
    }

    // MARK: - 阅读栏

    private func readingColumn(_ card: Card) -> some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                // 封顶三行:接口给的标题偶尔是一整句话,不封的话光标题就吃掉半个面板。
                Text(card.displayTitle)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(NotchInk.title)
                    .lineSpacing(4)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, hang)
                    .id(topAnchor)

                if let takeaway = card.keyTakeaway, !takeaway.isEmpty, takeaway != card.displayTitle {
                    gap(14)

                    // 要点必须和大标题长得不一样。22 粗体紧跟一行 15 粗体,看着就是
                    // 同一句话说了两遍。加一根竖条、把字重降到 medium,它才变成注解。
                    anchored(ink: 0.30) {
                        Text(takeaway)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(NotchInk.takeaway)
                            .lineSpacing(5)
                    }
                }

                if !card.displayBody.isEmpty {
                    gap(18)

                    Text(card.displayBody)
                        .font(.system(size: 13))
                        .foregroundStyle(NotchInk.prose)
                        .lineSpacing(6)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.leading, hang)
                }

                ForEach(Array(card.sections.enumerated()), id: \.offset) { index, section in
                    gap(20)
                    sectionBlock(section, index: index)
                }

                gap(28)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .coordinateSpace(name: readingSpace)
        // 底边渐隐:比硬切边缘更像成品。上短下长,因为下面才是「还有更多」的方向。
        .mask(
            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0),
                    .init(color: .black, location: 0.03),
                    .init(color: .black, location: 0.90),
                    .init(color: .clear, location: 1.0)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .onPreferenceChange(SectionOffsetKey.self) { offsets in
            sectionOffsets = offsets
        }
    }

    private func sectionBlock(_ section: Card.Section, index: Int) -> some View {
        anchored(ink: index == activeSection ? 0.30 : 0.14) {
            VStack(alignment: .leading, spacing: 5) {
                if !section.title.isEmpty {
                    // 小节标题比正文更小更淡是**有意的**:视线先落在正文上,标题只当路牌。
                    // 反过来的话,六个小节读下来全是标题在叫。
                    Text(section.title)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(NotchInk.sectionTag)
                }

                Text(section.body)
                    .font(.system(size: 13))
                    .foregroundStyle(NotchInk.prose)
                    .lineSpacing(6)
            }
        }
        .id(sectionAnchor(index))
        .background(
            GeometryReader { geometry in
                Color.clear.preference(
                    key: SectionOffsetKey.self,
                    value: [index: geometry.frame(in: .named(readingSpace)).minY]
                )
            }
        )
    }

    /// 挂式缩进的那一根竖条:内容左边 3 点宽,文字从 15 开始。
    private func anchored<Content: View>(ink: Double, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 1.5)
                .fill(.white.opacity(ink))
                .frame(width: 3)
                .frame(maxHeight: .infinity)

            content()
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func gap(_ height: CGFloat) -> some View {
        Spacer().frame(height: height)
    }

    /// 读到哪一节:最后一个还没被滚出顶边的小节。
    private var activeSection: Int {
        sectionOffsets
            .filter { $0.value <= 8 }
            .max(by: { $0.value < $1.value })?
            .key ?? 0
    }

    // MARK: - 侧栏

    @ViewBuilder
    private func sideColumn(_ card: Card, proxy: ScrollViewProxy) -> some View {
        if card.reviewPrompt?.isEmpty == false || !card.conceptNames.isEmpty || !card.sections.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                if let prompt = card.reviewPrompt, !prompt.isEmpty {
                    reviewBlock(prompt, isDue: card.isReviewDue)
                    gap(16)
                }

                if !card.conceptNames.isEmpty {
                    conceptBlock(card)
                    gap(16)
                }

                if !card.sections.isEmpty {
                    sectionList(card, proxy: proxy)
                }

                Spacer(minLength: 16)

                sourceBlock(card)
            }
        } else {
            // 侧栏空了也不能让阅读栏吃满,那样又回到「一行横穿到底」。
            VStack(spacing: 8) {
                Spacer()

                Image(systemName: "circle.dashed")
                    .font(.system(size: 20))
                    .foregroundStyle(NotchInk.faint)

                Text("这张卡还没连上别的卡")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.50))

                Text("读完点右下角标记,它会自己长出来")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(NotchInk.faint)
                    .multilineTextAlignment(.center)

                Spacer()
            }
            .frame(maxWidth: .infinity)
        }
    }

    /// 全篇唯一允许的「卡中卡」。重点态只把底色和描边各加一档,不换配色、不加彩底。
    private func reviewBlock(_ prompt: String, isDue: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                Text("复习问题")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(NotchInk.label)

                Spacer()

                if isDue {
                    Circle()
                        .fill(NotchAccent.amber.opacity(0.90))
                        .frame(width: 5, height: 5)
                }
            }

            gap(6)

            Text(prompt)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(NotchInk.review)
                .lineSpacing(4)
                .lineLimit(5)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(isDue ? NotchSurface.fillHi : NotchSurface.fill)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(isDue ? NotchSurface.strokeHi : NotchSurface.stroke, lineWidth: 1)
                )
        )
    }

    private func conceptBlock(_ card: Card) -> some View {
        let names = card.conceptNames
        let shown = Array(names.prefix(7))

        return VStack(alignment: .leading, spacing: 0) {
            blockHeader("概念", trailing: "\(names.count)")

            gap(8)

            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(shown.enumerated()), id: \.offset) { index, name in
                    HStack(spacing: 10) {
                        // 竖条逐行变淡,让一列并排项从「列表」变成「结构」。
                        RoundedRectangle(cornerRadius: 1.5)
                            .fill(.white.opacity(max(0.12, 0.24 - Double(index) * 0.02)))
                            .frame(width: 3, height: 12)

                        Text(name)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(NotchInk.read)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }

                if names.count > shown.count {
                    Text("+\(names.count - shown.count) 个")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(.white.opacity(0.28))
                        .padding(.leading, 13)
                }
            }
        }
    }

    /// 这一个构件同时是目录和阅读进度。
    private func sectionList(_ card: Card, proxy: ScrollViewProxy) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            blockHeader("章节", trailing: "\(card.sections.count) 节")

            gap(8)

            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(card.sections.enumerated()), id: \.offset) { index, section in
                    HStack(spacing: 8) {
                        RoundedRectangle(cornerRadius: 1)
                            .fill(.white.opacity(index == activeSection ? 0.55 : 0.14))
                            .frame(width: 2, height: 12)

                        Text(section.title)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(.white.opacity(index == activeSection ? 0.78 : 0.40))
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture {
                        withAnimation(.easeInOut(duration: 0.22)) {
                            proxy.scrollTo(sectionAnchor(index), anchor: .top)
                        }
                    }
                    .hoverPointer()
                }
            }
        }
    }

    private func sourceBlock(_ card: Card) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle()
                .fill(NotchSurface.hairline)
                .frame(height: 1)

            gap(10)

            Text("来源")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(NotchInk.label)

            gap(4)

            Text(card.sourceTitle ?? "未知来源")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(NotchInk.source)
                .lineSpacing(2)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func blockHeader(_ title: String, trailing: String) -> some View {
        HStack(spacing: 0) {
            Text(title)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(NotchInk.label)

            Spacer()

            Text(trailing)
                .font(.system(size: 10, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(NotchInk.faint)
        }
    }

    // MARK: - 底通栏

    private func footer(_ card: Card) -> some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(NotchSurface.hairline)
                .frame(height: 1)

            HStack(spacing: 20) {
                pageDots

                Spacer(minLength: 12)

                if card.reviewPrompt?.isEmpty == false, card.topicId?.isEmpty == false {
                    footerAction(marked ? "已记下" : "标记已复习", icon: marked ? "checkmark" : nil) {
                        Task {
                            marked = await store.markReviewed(card)
                        }
                    }
                    .disabled(marked)
                }

                if let urlString = card.sourceUrl, let url = URL(string: urlString) {
                    footerAction("在网页里打开", icon: "arrow.up.right") {
                        NSWorkspace.shared.open(url)
                    }
                }
            }
            .frame(height: 15)
            .padding(.vertical, 12)
        }
        .frame(height: 40)
    }

    /// 把「1/3」画成一组点。会变的数字才用文字,不变的结构画成几何。
    @ViewBuilder
    private var pageDots: some View {
        if store.cards.count > 8 {
            Text("\(store.index + 1) / \(store.cards.count)")
                .font(.system(size: 11, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(.white.opacity(0.45))
        } else {
            HStack(spacing: 5) {
                ForEach(0..<store.cards.count, id: \.self) { index in
                    Capsule()
                        .fill(.white.opacity(index == store.index ? 0.85 : 0.22))
                        .frame(width: index == store.index ? 10 : 4, height: 4)
                }
            }
            .animation(.easeOut(duration: 0.18), value: store.index)
        }
    }

    /// 动作留在底栏、带文字。做成只有图标的圆钮认不出来 —— 打勾和外链的语义太弱。
    private func footerAction(_ label: String, icon: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 9, weight: .semibold))
                }

                Text(label)
                    .font(.system(size: 11, weight: .medium))
            }
            .foregroundStyle(NotchInk.meta)
        }
        .buttonStyle(.plain)
        .hoverPointer()
    }

    // MARK: - 空态

    private var empty: some View {
        VStack(spacing: 8) {
            Spacer()

            Image(systemName: store.isOffline ? "bolt.horizontal" : "circle.dashed")
                .font(.system(size: 20))
                .foregroundStyle(NotchInk.faint)

            Text(placeholder.headline)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white.opacity(0.50))

            Text(placeholder.hint)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(NotchInk.faint)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var placeholder: (headline: String, hint: String) {
        if !store.hasLoadedOnce { return ("正在读知识库", "稍等一下") }
        if store.isOffline { return ("本机 AITimeline 没在跑", "打开它,卡就回来了") }

        return ("今天没有要回来的卡", "存点东西,过几天它自己找上来")
    }

    private let readingSpace = "reading"
    private let topAnchor = "top"

    private func sectionAnchor(_ index: Int) -> String {
        "section-\(index)"
    }
}
