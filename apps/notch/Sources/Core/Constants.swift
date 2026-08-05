import SwiftUI

/// 尺寸、圆角、动画的全部常数。
///
/// 这一组数**照抄 SuperIsland**(`SuperIsland/Utilities/Constants.swift`)。
/// 用户的要求是「刘海的效果要和它一模一样」,手感就藏在这些数里 ——
/// 弹簧的时长和回弹量、圆角的大小、悬停等多久。改任何一个都会让手感偏掉。
enum Constants {
    // MARK: - 三档尺寸

    /// 没有刘海的机器上,静默态的兜底尺寸。
    static let compactSize = CGSize(width: 200, height: 36)
    /// 中间那档:悬停就出这个,一张卡的标题和第几张。
    static let expandedSize = CGSize(width: 408, height: 88)
    /// 最大那档:半屏阅读面板。SuperIsland 原值是 658×180(五六行正文),
    /// 我们要读中长段,所以放大到半个屏幕,实际会按屏幕再夹一次。
    static let fullExpandedSize = CGSize(width: 900, height: 520)

    // MARK: - 静默态贴合刘海

    static let compactNotchHorizontalInset: CGFloat = 1
    static let compactNotchHeightInset: CGFloat = -4
    static let compactNotchBottomCornerRadius: CGFloat = 12
    static let compactNotchMinimumWidth: CGFloat = 168
    static let compactNotchMinimumHeight: CGFloat = 32
    /// 静默条要在刘海**两侧**各伸出这么宽。
    /// 刘海那块屏幕是物理上不显示的 —— 画在刘海里面的东西截图能看到、肉眼看不到。
    /// 所以图标和数字必须落在这两条伸出来的地方,中间留给刘海本身。
    static let compactSideExpansion: CGFloat = 56
    static let compactSidePadding: CGFloat = 14

    // MARK: - 圆角

    static let compactCornerRadius: CGFloat = 18
    static let expandedCornerRadius: CGFloat = 22
    static let fullExpandedCornerRadius: CGFloat = 40
    /// 展开档在有刘海的机器上,顶部两个「肩膀」的圆角。刘海本身是方的,
    /// 面板顶边要贴着它,所以肩膀不能是大圆角。
    static let shoulderCornerRadius: CGFloat = 10

    // MARK: - 窗口留白

    /// 面板左右各留这么宽给阴影和以后的翻页按钮。
    static let gutterWidth: CGFloat = 52
    /// 面板下方留给阴影的高度,不留会被窗口边缘切掉。
    static let shadowBottomPadding: CGFloat = 40
    /// 有刘海时展开档的顶部内容要让开刘海,再多让 5 点。
    static let notchHeightBoost: CGFloat = 5

    // MARK: - 动画

    /// 展开、收起、换档都用这一条弹簧。
    static let notchAnimation: Animation = .interactiveSpring(
        duration: 0.5,
        extraBounce: 0.25,
        blendDuration: 0.125
    )
    /// 面板里换内容(翻页、换卡)用这条,不带回弹。
    static let contentSwap: Animation = .smooth(duration: 0.22)
    /// 系统开了「减弱动态效果」时用这条。
    static let reducedMotion: Animation = .easeOut(duration: 0.12)

    // MARK: - 时间

    /// 鼠标停在刘海上多久才展开。SuperIsland 默认 0.3 秒。
    static let hoverPeekDelay: TimeInterval = 0.3
    /// 展开档在鼠标移开后多久自动收起。
    static let expandedAutoDismissDelay: TimeInterval = 1.5
    /// 半屏面板在鼠标移开后多久自动收起。读东西的时候手会离开,所以给得长。
    static let fullExpandedAutoDismissDelay: TimeInterval = 4.0
    /// 收起动画放完再把窗口缩回去,免得动画中途被窗口边缘裁掉。
    static let shrinkDelay: TimeInterval = 0.55
}
