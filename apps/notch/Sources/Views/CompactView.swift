import SwiftUI

/// 静默态:贴着刘海的一条,左边一个卡叠标记,右边一个数字。
///
/// 这一档只回答一件事:**有几张知识卡在等我、急不急**。一个字都不用读。
///
/// 量尺:面板 295 宽,但 `PillShape` 的顶角是往外拐的,侧墙在边界往里缩一个顶角半径,
/// 所以肉眼可见的黑体只有 x ∈ [12, 283]。刘海本体占中间 183,两翼真正能用的是 44 宽,
/// 内容离墙 10 起算 —— 按 56 排会有一截画在墙外面。
struct CompactView: View {
    @EnvironmentObject private var appState: AppState
    @ObservedObject private var store = CardStore.shared
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
            CardStackMark(pulsing: pulsing, dimmed: store.isOffline)
                .padding(.leading, 22)

            // 中间让给刘海。这一段屏幕物理上不显示,画什么都白画。
            Spacer(minLength: gap)

            if !store.isOffline {
                Text(count)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(countInk)
                    .padding(.trailing, 22)
            }
        }
        // 两翼内容的中心线要和菜单栏两侧的图标对齐。条比刘海多探出 4,所以往上让 1。
        .offset(y: -1)
    }

    /// 没有刘海的屏:一颗从顶边中央挂下来的药丸,内容居中排。
    /// 中间没有东西挡着,所以卡叠标记和数字靠在一起,不像有刘海时那样分居两侧。
    private var pill: some View {
        HStack(spacing: 10) {
            CardStackMark(pulsing: pulsing, dimmed: store.isOffline)

            if !store.isOffline {
                Text(count)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(countInk)
            }
        }
        .frame(maxWidth: .infinity)
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
