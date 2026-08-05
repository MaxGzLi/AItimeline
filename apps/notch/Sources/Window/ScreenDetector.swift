import AppKit

/// 刘海在哪、多大。
///
/// 苹果从 macOS 12 起给有刘海的屏幕提供了两块「辅助区域」—— 刘海左边和右边那两条
/// 能放菜单栏的地方。刘海就是这两块之间的缺口,拿屏幕宽度减掉两边就是它的宽。
/// 这是唯一可靠的算法:硬编码机型尺寸会在下一代机器上错。
enum ScreenDetector {
    struct CompactMetrics {
        let size: CGSize
        let bottomCornerRadius: CGFloat
        /// 中间这么宽是刘海本身占的,不能往里放东西。
        let notchGap: CGFloat
    }

    static func hasNotch(screen: NSScreen) -> Bool {
        screen.auxiliaryTopLeftArea != nil && screen.auxiliaryTopRightArea != nil
    }

    static func notchRect(screen: NSScreen) -> NSRect? {
        guard let left = screen.auxiliaryTopLeftArea,
              let right = screen.auxiliaryTopRightArea else {
            return nil
        }

        let frame = screen.frame
        let height = max(left.height, right.height)

        return NSRect(
            x: frame.origin.x + left.width,
            y: frame.maxY - height,
            width: frame.width - left.width - right.width,
            height: height
        )
    }

    /// 静默态从刘海两侧各伸出一截,往下探出一点点,和刘海连成一块 ——
    /// 看着像刘海自己变宽变高了。图标和数字放在伸出来的两截上,
    /// 中间那段是刘海本身,放什么都看不见。
    static func compactMetrics(screen: NSScreen) -> CompactMetrics? {
        guard let notch = notchRect(screen: screen) else { return nil }

        let gap = max(
            Constants.compactNotchMinimumWidth,
            notch.width - (Constants.compactNotchHorizontalInset * 2)
        )
        let height = max(
            Constants.compactNotchMinimumHeight,
            notch.height - Constants.compactNotchHeightInset
        )

        return CompactMetrics(
            size: CGSize(width: gap + Constants.compactSideExpansion * 2, height: height),
            bottomCornerRadius: min(Constants.compactNotchBottomCornerRadius, height / 2),
            notchGap: gap
        )
    }

    /// 鼠标现在在哪块屏上。
    static var activeScreen: NSScreen? {
        let mouse = NSEvent.mouseLocation
        return NSScreen.screens.first { $0.frame.contains(mouse) }
    }

    /// 优先挑有刘海的那块屏;一块都没有就用主屏。
    static var preferredScreen: NSScreen? {
        NSScreen.screens.first(where: hasNotch(screen:)) ?? NSScreen.main
    }
}
