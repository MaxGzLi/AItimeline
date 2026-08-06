import SwiftUI

/// 静默态:贴着刘海的一条,左边一个记号,右边一个数。
///
/// 这一档只回答一件事:**眼下最急的那样东西怎么样了**。一个字都不用读。
/// 「最急的是哪样」由 `StripPriority` 定,同时只显示一个;**一件都没有就报时间**。
///
/// 报时是这一条的静息状态,不是一个功能:一个不变的数字挂在屏幕最顶上,看一眼就知道
/// 「没事」,不用去猜它什么意思。左边那个记号在报时的时候照常在 —— 它认的是应用,不是内容。
///
/// 量尺:面板 295 宽,但 `PillShape` 的顶角是往外拐的,侧墙在边界往里缩一个顶角半径,
/// 所以肉眼可见的黑体只有 x ∈ [12, 283]。刘海本体占中间 183,两翼真正能用的是 44 宽,
/// 内容离墙 10 起算 —— 按 56 排会有一截画在墙外面。
struct CompactView: View {
    @EnvironmentObject private var appState: AppState
    @ObservedObject private var store = CardStore.shared
    @ObservedObject private var timer = FocusTimer.shared
    @ObservedObject private var agenda = AgendaStore.shared
    @ObservedObject private var shelf = ShelfStore.shared
    @ObservedObject private var agents = AgentStore.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var pulsing = false

    var body: some View {
        Group {
            if let gap = appState.compactMetrics?.notchGap {
                wings(gap: gap)
            } else {
                pill
            }
        }
        .frame(maxHeight: .infinity)
        .onChange(of: store.dueCount, initial: true) { old, new in
            guard !reduceMotion, old == 0, new > 0 else { return }

            startPulse()
        }
    }

    /// 有刘海的屏:内容分在刘海两侧,中间让开。
    private func wings(gap: CGFloat) -> some View {
        HStack(spacing: 0) {
            mark
                .padding(.leading, 22)

            // 中间让给刘海。这一段屏幕物理上不显示,画什么都白画。
            Spacer(minLength: gap)

            readout
                .padding(.trailing, 22)
        }
        // 两翼内容的中心线要和菜单栏两侧的图标对齐。条比刘海多探出 4,所以往上让 1。
        .offset(y: -1)
    }

    /// 没有刘海的屏:一颗从顶边中央挂下来的药丸,内容居中排。
    /// 中间没有东西挡着,所以记号和数靠在一起,不像有刘海时那样分居两侧。
    private var pill: some View {
        HStack(spacing: 10) {
            mark
            readout
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - 左边的记号

    @ViewBuilder
    private var mark: some View {
        switch StripPriority.subject {
        case .face(.agents):
            glyph(agents.strip?.symbol ?? "chevron.left.forwardslash.chevron.right")
        case .face(.focus):
            glyph(timer.phase.symbol)
        case .face(.agenda):
            glyph("calendar")
        case .face(.shelf):
            glyph("tray.and.arrow.down")
        // 报时的时候左边还是这个记号。它认的是「这条黑边是谁」,不是「现在有几张卡」,
        // 所以两种情形共用一个:换掉它,条看起来就像换了一个应用。
        case .face(.cards), .clock:
            CardStackMark(pulsing: pulsing, dimmed: store.isOffline)
        }
    }

    private func glyph(_ symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(.white.opacity(0.82))
    }

    // MARK: - 右边的数

    @ViewBuilder
    private var readout: some View {
        switch StripPriority.subject {
        case .face(.agents):
            // 琥珀只给「要你动手」(要权限、这轮挂了)。「干完了」是白的 ——
            // 它可以等,你什么时候抬头看都行,不该拿最扎眼的颜色去催。
            if let strip = agents.strip {
                Text(strip.text)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(
                        strip.urgent
                            ? NotchAccent.amber.opacity(0.95)
                            : .white.opacity(0.80)
                    )
            }
        case .face(.focus):
            // 等宽,不然秒一跳整条会横着抖。
            Text(timer.clock)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(.white.opacity(0.88))
        case .face(.agenda):
            Text(minutesToNext)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.white.opacity(0.80))
        case .face(.shelf):
            Text("\(shelf.inFlight)")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.white.opacity(0.80))
        case .face(.cards):
            // 走到这里只有一种情形:有卡到复习期了。所以这个数天生是琥珀的 ——
            // 条上不再出现「攒了几张」那种不痛不痒的白数字。
            Text(store.dueCount > 99 ? "99+" : "\(store.dueCount)")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(NotchAccent.amber.opacity(0.95))
        case .clock:
            // 和番茄钟同一个位子、同一号字 —— 番茄钟一停,那一格自然接上时间,不跳字号。
            // 比番茄钟淡一档:它在倒数,是要你看的;时间只是「这里现在没事」。
            Text(AgendaStore.stripClock(agenda.now))
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(NotchInk.meta)
        }
    }

    /// 翼展只有 44 —— 「12 分钟后」放不下,只留数字和一个「分」。
    private var minutesToNext: String {
        guard let next = agenda.nextEvent else { return "" }

        let minutes = Int((next.start.timeIntervalSince(agenda.now) / 60).rounded(.up))

        return "\(max(0, minutes))分"
    }

    /// 呼吸只跑 6 秒就停。屏幕最顶上一直动的东西,看久了是骚扰,也白耗电。
    private func startPulse() {
        pulsing = true

        Task {
            try? await Task.sleep(for: .seconds(6))
            pulsing = false
        }
    }

}
