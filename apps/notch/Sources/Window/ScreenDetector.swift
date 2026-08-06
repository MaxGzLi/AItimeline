import AppKit

/// 刘海在哪、多大,以及画在哪块屏上。
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

    /// 用户选了画在哪块屏。空串 = 自动。
    static let displayPreferenceKey = "notch.displayIdentifier"

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

    // MARK: - 选屏

    /// 每块屏的身份证:`CGDirectDisplayID` 的十进制串。屏名会变、位置会变,这个不会。
    static func identifier(for screen: NSScreen) -> String? {
        guard let number = screen.deviceDescription[
            NSDeviceDescriptionKey("NSScreenNumber")
        ] as? NSNumber else {
            return nil
        }

        return "\(number.uint32Value)"
    }

    static func screen(withIdentifier identifier: String) -> NSScreen? {
        NSScreen.screens.first { self.identifier(for: $0) == identifier }
    }

    /// 菜单里那份屏幕清单。有刘海的标出来,用户一眼能分清哪块是笔记本。
    static func availableScreens() -> [(id: String, name: String)] {
        NSScreen.screens.compactMap { screen in
            guard let id = identifier(for: screen) else { return nil }

            let suffix = hasNotch(screen: screen) ? " — 有刘海" : ""

            return (id, screen.localizedName + suffix)
        }
    }

    /// 画在哪块屏上。
    ///
    /// 顺序:用户指定的那块 → 系统的主显示器(`NSScreen.screens.first`,也就是菜单栏所在那块)
    /// → 有刘海的那块 → 随便第一块。
    ///
    /// **默认跟主显示器,不是跟刘海。** 之前写死「挑有刘海的那块」,结果是多屏的人
    /// 主力屏上永远看不见它,它一直趴在合着的笔记本屏上。
    /// 也不做「实时跟鼠标」—— 那个看着聪明,用起来是条来回乱飞的黑条。
    static var preferredScreen: NSScreen? {
        let preference = UserDefaults.standard.string(forKey: displayPreferenceKey) ?? ""

        if !preference.isEmpty, let picked = screen(withIdentifier: preference) {
            return picked
        }

        return NSScreen.screens.first
            ?? NSScreen.screens.first(where: hasNotch(screen:))
            ?? NSScreen.main
    }

    /// 用户指定的屏被拔掉了就回落到自动 —— 不然一块面板都建不出来,应用像是死了。
    static func dropStaleDisplayPreference() {
        let preference = UserDefaults.standard.string(forKey: displayPreferenceKey) ?? ""

        guard !preference.isEmpty, screen(withIdentifier: preference) == nil else { return }

        UserDefaults.standard.removeObject(forKey: displayPreferenceKey)
    }
}
