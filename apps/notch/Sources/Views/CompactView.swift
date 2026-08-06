import SwiftUI

/// 静默态:贴着刘海的一条,左边一个记号,右边一个数。
///
/// 这一档只回答一件事:**眼下最急的那样东西怎么样了**。一个字都不用读。
/// 「最急的是哪样」由 `StripPriority` 定,同时只显示一个。
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
        switch StripPriority.face {
        case .agents:
            glyph(agents.strip?.symbol ?? "chevron.left.forwardslash.chevron.right")
        case .focus:
            glyph(timer.phase.symbol)
        case .agenda:
            glyph("calendar")
        case .shelf:
            glyph("tray.and.arrow.down")
        case .cards:
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
        switch StripPriority.face {
        case .agents:
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
        case .focus:
            // 等宽,不然秒一跳整条会横着抖。
            Text(timer.clock)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(.white.opacity(0.88))
        case .agenda:
            Text(minutesToNext)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.white.opacity(0.80))
        case .shelf:
            Text("\(shelf.inFlight)")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.white.opacity(0.80))
        case .cards:
            if !store.isOffline {
                Text(count)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(countInk)
            }
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

    private var count: String {
        guard store.hasLoadedOnce else { return "…" }
        guard !store.cards.isEmpty else { return "—" }

        let value = store.dueCount > 0 ? store.dueCount : store.cards.count

        return value > 99 ? "99+" : "\(value)"
    }

    private var countInk: Color {
        guard store.hasLoadedOnce else { return .white.opacity(0.30) }
        guard !store.cards.isEmpty else { return .white.opacity(0.25) }

        return store.dueCount > 0 ? NotchAccent.amber.opacity(0.95) : .white.opacity(0.38)
    }
}
