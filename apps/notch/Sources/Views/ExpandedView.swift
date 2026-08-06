import SwiftUI

/// 悬停出来的小条:面板 408×88。
///
/// 这一档只回答两件事:**这张卡的结论是一句什么话、为什么是现在给我看**。
/// 停 0.3 秒读完就能决定点不点开,所以不放正文、不放截断的半句话。
///
/// 版面账(有刘海时):
/// - 上面 37 是让开刘海的带子,元信息(来源、状态、页码)就装在这条带子的两翼里;
/// - 下面 51 只放一个来源方块和两行结论。88 高刨掉 37 只剩 51,
///   元信息再挤进来必然裁字 —— 搬进带子之后反而多出 11 点空气。
struct ExpandedView: View {
    @EnvironmentObject private var appState: AppState
    @ObservedObject private var store = CardStore.shared
    @ObservedObject private var shelf = ShelfStore.shared
    @ObservedObject private var timer = FocusTimer.shared
    @ObservedObject private var agenda = AgendaStore.shared

    /// 左右各留 34。原版是容器 26 + 内容 8 两级叠出来的,408 宽里内容只占 340(83%)。
    /// 留白靠绝对像素,不靠百分比 —— 小面板用百分比会在窄档显得挤、宽档显得空。
    private let sidePadding: CGFloat = 34
    private let tileSize: CGFloat = 36

    var body: some View {
        VStack(spacing: 0) {
            if appState.contentTopInset > 0 {
                shoulder
                    .frame(height: appState.contentTopInset)
                    .clipped()

                content
                    .padding(.horizontal, sidePadding)
                    .padding(.top, 4)
                    .padding(.bottom, 11)
                    .frame(maxHeight: .infinity, alignment: .top)
            } else {
                // 没刘海的机器:带子是零,元信息回到内容上方排一行。
                flatMeta
                    .padding(.horizontal, sidePadding)
                    .padding(.top, 10)
                    .padding(.bottom, 8)

                content
                    .padding(.horizontal, sidePadding)
                    .padding(.bottom, 22)
                    .frame(maxHeight: .infinity, alignment: .top)
            }
        }
    }

    // MARK: - 让位带里的肩栏

    private var shoulder: some View {
        let wing = max(0, (appState.currentSize.width - 40 - appState.shoulderGap) / 2)

        return HStack(spacing: 0) {
            sourceLine
                .frame(width: wing, alignment: .leading)

            Spacer(minLength: appState.shoulderGap)

            trailingMeta
                .frame(width: wing, alignment: .trailing)
        }
        // 肩栏自己一套内边距,比内容区那 34 窄一档。
        .padding(.horizontal, 20)
        .frame(maxHeight: .infinity)
    }

    private var sourceLine: some View {
        Text(appState.selectedFace == .cards ? (store.current?.sourceTitle ?? "") : appState.selectedFace.title)
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(NotchInk.weak)
            .lineLimit(1)
            .truncationMode(.tail)
    }

    @ViewBuilder
    private var trailingMeta: some View {
        switch appState.selectedFace {
        case .shelf:
            tail(shelf.items.isEmpty ? "" : "\(shelf.items.count) 条")
        case .focus:
            tail("今天 \(timer.roundsToday) 轮")
        case .agenda:
            tail(AgendaStore.label(agenda.now, "EEEMMMd"))
        case .cards:
            cardMeta
        }
    }

    private func tail(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(NotchInk.ghost)
    }

    @ViewBuilder
    private var cardMeta: some View {
        if let card = store.current {
            HStack(spacing: 8) {
                // 状态不做成实心徽章。深色面板上的实心色块是整版最模板化的一处,
                // 换成「圆点 + 有色文字」立刻干净。
                HStack(spacing: 5) {
                    if card.isReviewDue {
                        Circle()
                            .fill(NotchAccent.amber.opacity(0.92))
                            .frame(width: 4, height: 4)
                    }

                    Text(card.timelinessLabel)
                        .font(.system(size: 10, weight: card.isReviewDue ? .semibold : .medium))
                        .foregroundStyle(card.isReviewDue ? NotchAccent.amber.opacity(0.90) : NotchInk.weak)
                }

                Text("\(store.index + 1)/\(store.cards.count)")
                    .font(.system(size: 10, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(NotchInk.ghost)
            }
        }
    }

    private var flatMeta: some View {
        HStack(spacing: 8) {
            sourceLine
            Spacer(minLength: 12)
            trailingMeta
        }
        .frame(height: 12)
    }

    // MARK: - 一句结论

    @ViewBuilder
    private var content: some View {
        switch appState.selectedFace {
        case .shelf:
            // 刚往刘海上扔完东西,悬停要看的是「它落地了没有」,不是知识卡。
            peek(
                "tray",
                shelf.items.first?.title ?? "架子是空的",
                shelf.items.first.map { "\($0.detail) · \($0.status)" } ?? "把链接或截图拖上来"
            )
        case .focus:
            peek(
                timer.phase.symbol,
                "\(timer.clock) · \(timer.phase.title)",
                timer.running ? "今天已经 \(timer.roundsToday) 轮" : "停着,点开继续"
            )
        case .agenda:
            if let next = agenda.nextEvent {
                peek("calendar", next.title, "\(next.timeLabel) · \(next.countdown(from: agenda.now))")
            } else {
                peek("calendar", AgendaStore.hhmm(agenda.now), agenda.access == .granted ? "接下来没安排" : "还没拿到日历权限")
            }
        case .cards:
            if let card = store.current {
                HStack(alignment: .center, spacing: 12) {
                    SourceTile(letter: card.sourceLetter, size: tileSize)

                    Text(card.lead)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(NotchInk.body)
                        .lineLimit(2)
                        .truncationMode(.tail)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(height: tileSize)
            } else {
                empty
            }
        }
    }

    /// 知识卡以外的面,悬停这一档都是同一个形状:一个方块图标 + 一行结论 + 一行细账。
    private func peek(_ symbol: String, _ headline: String, _ detail: String) -> some View {
        HStack(alignment: .center, spacing: 12) {
            RoundedRectangle(cornerRadius: tileSize * 0.15, style: .continuous)
                .fill(NotchSurface.tile)
                .overlay(
                    RoundedRectangle(cornerRadius: tileSize * 0.15, style: .continuous)
                        .stroke(NotchSurface.tileEdge, lineWidth: 1)
                )
                .overlay(
                    Image(systemName: symbol)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white.opacity(0.62))
                )
                .frame(width: tileSize, height: tileSize)

            VStack(alignment: .leading, spacing: 3) {
                Text(headline)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(NotchInk.body)
                    .lineLimit(1)

                Text(detail)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(NotchInk.faint)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
        .frame(height: tileSize)
    }

    private var empty: some View {
        HStack(alignment: .center, spacing: 12) {
            RoundedRectangle(cornerRadius: tileSize * 0.15, style: .continuous)
                .fill(.white.opacity(0.03))
                .overlay(
                    RoundedRectangle(cornerRadius: tileSize * 0.15, style: .continuous)
                        .stroke(.white.opacity(0.07), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                )
                .frame(width: tileSize, height: tileSize)

            VStack(alignment: .leading, spacing: 3) {
                Text(placeholder.headline)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.55))

                Text(placeholder.hint)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(NotchInk.faint)
            }

            Spacer(minLength: 0)
        }
        .frame(height: tileSize)
    }

    private var placeholder: (headline: String, hint: String) {
        if !store.hasLoadedOnce { return ("正在读知识库", "稍等一下") }
        if store.isOffline { return ("本机 AITimeline 没在跑", "打开它,卡就回来了") }

        return ("今天没有要回来的卡", "存点东西,过几天它自己找上来")
    }
}
