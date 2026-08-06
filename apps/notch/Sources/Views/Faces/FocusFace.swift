import SwiftUI

/// 专注面:番茄钟。
///
/// 骨架跟别的面一模一样(左栏 / 竖线 / 右 236),切面的时候两条竖线纹丝不动。
///
/// **不给它上色。** 原版专注是橙、休息是绿、最后一分钟转红;我们这块面板只有
/// 白色的明暗梯队,那一点琥珀色是留给「该复习」的。专注和休息的区别靠字说清楚
/// (「专注」/「休息」),不靠颜色 —— 一上色整块面板就开始像模板。
struct FocusFace: View {
    @EnvironmentObject private var appState: AppState
    @ObservedObject private var timer = FocusTimer.shared

    private var sidePadding: CGFloat { appState.contentSidePadding }
    private let columnGap: CGFloat = 20
    private let sideWidth: CGFloat = 236

    var body: some View {
        VStack(spacing: 0) {
            columns
                .padding(.horizontal, sidePadding)
                .padding(.top, 12)
                .frame(maxHeight: .infinity, alignment: .top)

            footer
                .padding(.horizontal, sidePadding)
                .padding(.bottom, Constants.footerBottomInset)
        }
    }

    private var columns: some View {
        let total = appState.currentSize.width - sidePadding * 2
        let main = max(320, total - columnGap * 2 - 1 - sideWidth)

        return HStack(spacing: 0) {
            dial
                .frame(width: main)

            Spacer()
                .frame(width: columnGap)

            Rectangle()
                .fill(NotchSurface.hairline)
                .frame(width: 1)
                .padding(.vertical, 4)

            Spacer()
                .frame(width: columnGap)

            sideColumn
                .frame(width: sideWidth)
        }
    }

    // MARK: - 表盘

    private var dial: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)

            Text(timer.phase.title)
                .font(.system(size: 11, weight: .semibold))
                .tracking(1.5)
                .foregroundStyle(NotchInk.label)

            Spacer().frame(height: 10)

            // 数字用等宽,不然秒一跳整行字就横着挪。
            Text(timer.clock)
                .font(.system(size: 64, weight: .medium, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(NotchInk.title)

            Spacer().frame(height: 4)

            Text(hint)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(NotchInk.faint)

            Spacer().frame(height: 22)

            bar

            Spacer().frame(height: 22)

            controls

            Spacer(minLength: 0)
        }
    }

    /// 进度是**一条直的**,不是环。原版全展开档也是直条(高 6)。
    /// 环在这么大的面板上会变成一个大靶子,压过所有别的东西。
    private var bar: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(.white.opacity(0.09))

                Capsule()
                    .fill(.white.opacity(0.55))
                    .frame(width: max(0, geometry.size.width * timer.progress))
            }
        }
        .frame(height: 6)
        .padding(.horizontal, 40)
        .animation(.linear(duration: 0.9), value: timer.progress)
    }

    private var controls: some View {
        HStack(spacing: 14) {
            ghost("arrow.counterclockwise", "重来") { timer.reset() }

            Button {
                timer.toggle()
            } label: {
                ZStack {
                    Circle()
                        .fill(.white.opacity(timer.running ? 0.12 : 0.92))

                    Image(systemName: timer.running ? "pause.fill" : "play.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(timer.running ? .white.opacity(0.92) : .black.opacity(0.85))
                        // play 的三角形视觉重心偏左,推 2 点才在正中。
                        .offset(x: timer.running ? 0 : 2)
                }
                .frame(width: 46, height: 46)
            }
            .buttonStyle(.plain)
            .hoverPointer()

            ghost("forward.fill", "跳过这一档") { timer.skip() }
        }
    }

    private func ghost(_ symbol: String, _ help: String, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white.opacity(0.50))
                .frame(width: 30, height: 30)
        }
        .buttonStyle(.plain)
        .help(help)
        .hoverPointer()
    }

    private var hint: String {
        if timer.running {
            return timer.phase == .focus ? "走完自动进休息" : "歇完停下来等你"
        }

        return timer.remaining < timer.phaseLength ? "停在这儿了" : "点中间那个开始"
    }

    // MARK: - 右栏

    private var sideColumn: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("今天")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(NotchInk.label)

            Spacer().frame(height: 10)

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(timer.roundsToday)")
                    .font(.system(size: 22, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(NotchInk.body)

                Text("轮专注")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(NotchInk.faint)
            }

            Spacer().frame(height: 10)

            // 一天几轮不用数字排一行,用格子:一眼看得出今天是满的还是空的。
            HStack(spacing: 5) {
                ForEach(0..<8, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(.white.opacity(index < timer.roundsToday ? 0.55 : 0.08))
                        .frame(height: 6)
                }
            }

            Spacer(minLength: 16)

            Rectangle()
                .fill(NotchSurface.hairline)
                .frame(height: 1)

            Spacer().frame(height: 10)

            Text("这个钟的规矩")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(NotchInk.label)

            Spacer().frame(height: 4)

            Text("专注 25 分,休息 5 分。专注走完自动接休息;休息走完停下等你,要不要再来一轮你自己说。关了应用也照走,回来是真少了那么多。")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(NotchInk.faint)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - 底通栏

    private var footer: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(NotchSurface.hairline)
                .frame(height: 1)

            HStack(spacing: 20) {
                Text(timer.running ? "\(timer.phase.title)中" : "停着")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.45))

                Spacer(minLength: 12)

                Text("换档的时候刘海会自己弹出来")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(NotchInk.faint)
            }
            .frame(height: 15)
            .padding(.vertical, 12)
        }
        .frame(height: 40)
    }
}

/// 专注面在肩栏右翼放的东西。
struct FocusShoulderTrailing: View {
    @ObservedObject private var timer = FocusTimer.shared

    var body: some View {
        HStack(spacing: 12) {
            Spacer(minLength: 0)

            Text(timer.running ? timer.phase.title : "没在跑")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(NotchInk.weak)

            Text("今天 \(timer.roundsToday) 轮")
                .font(.system(size: 10, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(NotchInk.ghost)
        }
    }
}
