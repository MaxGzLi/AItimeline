import SwiftUI

/// 来源方块:一个圆角方块里放来源的首字母。
///
/// 三档都用它,只是尺寸不同(悬停 36、面板肩栏 18)。它的作用是给每一行字
/// 左边钉一个非文字的锚 —— 原版每个模块左边都有一块这样的东西(放歌是专辑封面、
/// 天气是图标),一整版纯文字才是「干巴」的根源。
struct SourceTile: View {
    let letter: String?
    let size: CGFloat

    var body: some View {
        let radius = size * 0.15

        return RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(NotchSurface.tile)
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(NotchSurface.tileEdge, lineWidth: 1)
            )
            .overlay(
                Text(letter ?? "")
                    .font(.system(size: (size * 0.47).rounded(), weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.62))
            )
            .frame(width: size, height: size)
    }
}

/// 静默条左翼那个卡叠标记:三根长短不一的横条。
///
/// 自己画不用系统图标 —— 它和悬停档的方块、面板档的竖条是同一套几何在三个尺寸上的
/// 变体,三档看着才像一个东西。图标一选不好就是廉价感的来源。
struct CardStackMark: View {
    /// 有卡到期时头几秒让第一根呼吸一下。屏幕最顶上常驻运动等于骚扰,所以会停。
    var pulsing: Bool
    /// 本机接口连不上:整块压暗,安静地不在了,不要橙色警告三角。
    var dimmed: Bool

    private let widths: [CGFloat] = [18, 13, 8.5]
    private let inks: [Double] = [0.90, 0.50, 0.28]

    var body: some View {
        VStack(alignment: .leading, spacing: 3.5) {
            ForEach(0..<3, id: \.self) { index in
                RoundedRectangle(cornerRadius: 1.25)
                    .fill(.white.opacity(ink(index)))
                    .frame(width: widths[index], height: 2.5)
                    .animation(pulseAnimation(index), value: pulsing)
            }
        }
    }

    private func ink(_ index: Int) -> Double {
        if dimmed { return 0.16 }

        return index == 0 && pulsing ? 0.50 : inks[index]
    }

    private func pulseAnimation(_ index: Int) -> Animation? {
        guard index == 0 else { return nil }

        return pulsing
            ? .easeInOut(duration: 1.8).repeatForever(autoreverses: true)
            : .easeOut(duration: 0.3)
    }
}

/// 刘海下沿的一道压痕:刘海正下方一条极淡的渐变。
///
/// 几行代码,但它和「上下圆角不等」是同一件事的两半 —— 有了它,面板看起来是从
/// 屏幕上沿长出来的,没有它就是贴上去的一块黑。
struct NotchSeam: View {
    let notchSize: CGSize

    var body: some View {
        Rectangle()
            .fill(
                LinearGradient(
                    colors: [.white.opacity(0.055), .clear],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .frame(width: notchSize.width + 48, height: 8)
            .mask(
                LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0),
                        .init(color: .black, location: 0.20),
                        .init(color: .black, location: 0.80),
                        .init(color: .clear, location: 1)
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .offset(y: notchSize.height)
            .allowsHitTesting(false)
    }
}
