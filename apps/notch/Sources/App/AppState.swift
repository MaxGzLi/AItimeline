import AppKit
import SwiftUI

enum IslandState {
    /// 静默态:贴着刘海的一条,只露图标和数字。
    case compact
    /// 悬停出来的小条:一张卡的标题和进度。
    case expanded
    /// 点开的半屏面板:读正文。
    case fullExpanded
}

/// 刘海的全部状态。窗口控制器盯着它改窗口,视图盯着它画内容。
@MainActor
final class AppState: ObservableObject {
    static let shared = AppState()

    @Published private(set) var currentState: IslandState = .compact {
        didSet {
            guard oldValue != currentState else { return }
            didChangeState?(oldValue, currentState)
        }
    }

    @Published var isHovering = false {
        didSet {
            guard oldValue != isHovering else { return }
            isHovering ? scheduleHoverPeek() : scheduleAutoDismiss()
        }
    }

    /// 窗口控制器挂在这里:状态一变就来改窗口尺寸。
    var didChangeState: ((IslandState, IslandState) -> Void)?

    /// 面板落在哪块屏上。屏幕拔插时由窗口控制器更新。
    @Published private(set) var screenFrame: CGRect = .zero
    @Published private(set) var notchRect: CGRect?
    @Published private(set) var compactMetrics: ScreenDetector.CompactMetrics?

    private var hoverWorkItem: DispatchWorkItem?
    private var dismissWorkItem: DispatchWorkItem?
    private var hoverAuditTimer: Timer?

    private init() {}

    // MARK: - 悬停校对

    /// 视图收到的「鼠标进/出」事件会漏。窗口尺寸刚变过、鼠标从别的空间切回来、
    /// 或者指针一步跳到远处(不是划过去的),都可能只收到进没收到出 ——
    /// 结果是面板以为鼠标还在上面,永远不自动收起。所以每半秒拿真实指针位置校对一次。
    func startHoverAudit() {
        hoverAuditTimer?.invalidate()

        let timer = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.auditHover() }
        }

        RunLoop.main.add(timer, forMode: .common)
        hoverAuditTimer = timer
    }

    private func auditHover() {
        let inside = surfaceRect.contains(NSEvent.mouseLocation)

        guard inside != isHovering else { return }

        isHovering = inside
    }

    /// 黑色面板在屏幕上的实际位置(窗口比它大一圈,那圈是透明的,不算)。
    private var surfaceRect: CGRect {
        let size = currentSize
        let anchorX = notchRect?.midX ?? screenFrame.midX
        let anchorY = notchRect?.maxY ?? screenFrame.maxY

        return CGRect(x: anchorX - size.width / 2, y: anchorY - size.height, width: size.width, height: size.height)
    }

    // MARK: - 屏幕

    func updateScreen(_ screen: NSScreen) {
        screenFrame = screen.frame
        notchRect = ScreenDetector.notchRect(screen: screen)
        compactMetrics = ScreenDetector.compactMetrics(screen: screen)
    }

    var hasNotch: Bool { notchRect != nil }

    // MARK: - 状态切换

    /// 悬停停够时间了才展开到小条。**不直接跳到半屏面板** ——
    /// 手伸向菜单栏一天要蹭过刘海几十次,每次都掉下来半个屏幕,
    /// 就成了「刘海自己在乱跳」(这是在别人的宿主上真踩过的)。
    private func scheduleHoverPeek() {
        cancelHoverPeek()

        let work = DispatchWorkItem { [weak self] in
            guard let self, self.isHovering, self.currentState == .compact else { return }
            self.transition(to: .expanded)
        }

        hoverWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Constants.hoverPeekDelay, execute: work)
    }

    private func cancelHoverPeek() {
        hoverWorkItem?.cancel()
        hoverWorkItem = nil
    }

    /// 点一下:静默/小条 → 半屏面板;已经在面板上就收起。
    func handleTap() {
        switch currentState {
        case .compact, .expanded:
            transition(to: .fullExpanded)
        case .fullExpanded:
            dismiss()
        }
    }

    func dismiss() {
        cancelHoverPeek()
        cancelAutoDismiss()
        transition(to: .compact)
    }

    private func transition(to state: IslandState) {
        cancelAutoDismiss()

        withAnimation(animation) {
            currentState = state
        }

        if state != .compact {
            scheduleAutoDismiss()
        }
    }

    private func scheduleAutoDismiss() {
        cancelAutoDismiss()

        guard currentState != .compact else { return }

        let delay = currentState == .fullExpanded
            ? Constants.fullExpandedAutoDismissDelay
            : Constants.expandedAutoDismissDelay

        let work = DispatchWorkItem { [weak self] in
            guard let self, !self.isHovering else { return }
            self.dismiss()
        }

        dismissWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func cancelAutoDismiss() {
        dismissWorkItem?.cancel()
        dismissWorkItem = nil
    }

    var animation: Animation {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
            ? Constants.reducedMotion
            : Constants.notchAnimation
    }

    // MARK: - 尺寸

    var currentSize: CGSize { size(for: currentState) }

    func size(for state: IslandState) -> CGSize {
        switch state {
        case .compact:
            return compactMetrics?.size ?? Constants.compactSize
        case .expanded:
            return Constants.expandedSize
        case .fullExpanded:
            return clampedFullExpandedSize
        }
    }

    /// 半屏面板不能撑出屏幕。窗口自己还要占掉左右的留白和下方的阴影,先减掉再夹。
    private var clampedFullExpandedSize: CGSize {
        let wanted = Constants.fullExpandedSize

        guard screenFrame != .zero else { return wanted }

        return CGSize(
            width: min(wanted.width, screenFrame.width - Constants.gutterWidth * 2 - 40),
            height: min(wanted.height, screenFrame.height - Constants.shadowBottomPadding - 40)
        )
    }

    /// 窗口比面板大一圈:左右各留出留白,下方留出阴影。
    func windowSize(for state: IslandState) -> CGSize {
        let size = self.size(for: state)

        guard state != .compact else { return size }

        return CGSize(
            width: size.width + Constants.gutterWidth * 2,
            height: size.height + Constants.shadowBottomPadding
        )
    }

    var windowSize: CGSize { windowSize(for: currentState) }

    // MARK: - 圆角

    /// 有刘海时,展开档的顶部两个「肩膀」得是小圆角:面板顶边贴着刘海,
    /// 大圆角会在刘海两侧露出两个豁口。
    private var usesShoulders: Bool {
        hasNotch && currentState != .compact
    }

    var topCornerRadius: CGFloat {
        usesShoulders ? Constants.shoulderCornerRadius : baseCornerRadius
    }

    var bottomCornerRadius: CGFloat { baseCornerRadius }

    private var baseCornerRadius: CGFloat {
        switch currentState {
        case .compact:
            return compactMetrics?.bottomCornerRadius ?? Constants.compactCornerRadius
        case .expanded:
            return Constants.expandedCornerRadius
        case .fullExpanded:
            return Constants.fullExpandedCornerRadius
        }
    }

    /// 有刘海时,面板里的内容要从刘海下面开始排,不然会被刘海压住。
    var contentTopInset: CGFloat {
        guard usesShoulders, let notch = notchRect else { return 0 }

        return notch.height + Constants.notchHeightBoost
    }
}
