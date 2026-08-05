import SwiftUI

/// 刘海那块黑色面板的形状。
///
/// 关键在**顶部两个角是往外拐的**(`outwardTopCorners`):面板顶边贴着屏幕最上沿,
/// 两侧的墙往下走之前先向外弯出去,和菜单栏那条黑边连成一体。普通的圆角矩形做不出
/// 这个效果 —— 那样顶部两角会往里收,面板看着是浮在屏幕上的一块,而不是刘海长出来的。
///
/// 圆角的四个值都参与动画(`animatableData`),所以从静默态的小圆角变到面板的大圆角
/// 是连续的,不会跳。
struct PillShape: Shape {
    var topLeadingRadius: CGFloat
    var topTrailingRadius: CGFloat
    var bottomLeadingRadius: CGFloat
    var bottomTrailingRadius: CGFloat
    var outwardTopCorners: Bool

    init(
        topLeadingRadius: CGFloat,
        topTrailingRadius: CGFloat,
        bottomLeadingRadius: CGFloat,
        bottomTrailingRadius: CGFloat,
        outwardTopCorners: Bool = true
    ) {
        self.topLeadingRadius = topLeadingRadius
        self.topTrailingRadius = topTrailingRadius
        self.bottomLeadingRadius = bottomLeadingRadius
        self.bottomTrailingRadius = bottomTrailingRadius
        self.outwardTopCorners = outwardTopCorners
    }

    var animatableData: AnimatablePair<
        AnimatablePair<CGFloat, CGFloat>,
        AnimatablePair<CGFloat, CGFloat>
    > {
        get {
            AnimatablePair(
                AnimatablePair(topLeadingRadius, topTrailingRadius),
                AnimatablePair(bottomLeadingRadius, bottomTrailingRadius)
            )
        }
        set {
            topLeadingRadius = newValue.first.first
            topTrailingRadius = newValue.first.second
            bottomLeadingRadius = newValue.second.first
            bottomTrailingRadius = newValue.second.second
        }
    }

    func path(in rect: CGRect) -> Path {
        let maxRadius = min(rect.width, rect.height) / 2
        let topLeading = min(topLeadingRadius, maxRadius)
        let topTrailing = min(topTrailingRadius, maxRadius)
        let bottomLeading = min(bottomLeadingRadius, maxRadius)
        let bottomTrailing = min(bottomTrailingRadius, maxRadius)

        return outwardTopCorners
            ? outwardPath(rect, topLeading, topTrailing, bottomLeading, bottomTrailing)
            : inwardPath(rect, topLeading, topTrailing, bottomLeading, bottomTrailing)
    }

    /// 顶角外拐:从屏幕顶边出发,先用一段二次曲线向内下方拐到「墙」上,
    /// 走到底再向外拐出去。左右对称。
    private func outwardPath(
        _ rect: CGRect,
        _ topLeading: CGFloat,
        _ topTrailing: CGFloat,
        _ bottomLeading: CGFloat,
        _ bottomTrailing: CGFloat
    ) -> Path {
        var path = Path()
        let leftWall = rect.minX + topLeading
        let rightWall = rect.maxX - topTrailing

        path.move(to: CGPoint(x: rect.minX, y: rect.minY))

        if topLeading > 0 {
            path.addQuadCurve(
                to: CGPoint(x: leftWall, y: rect.minY + topLeading),
                control: CGPoint(x: leftWall, y: rect.minY)
            )
        } else {
            path.addLine(to: CGPoint(x: leftWall, y: rect.minY))
        }

        path.addLine(to: CGPoint(x: leftWall, y: rect.maxY - bottomLeading))

        if bottomLeading > 0 {
            path.addQuadCurve(
                to: CGPoint(x: leftWall + bottomLeading, y: rect.maxY),
                control: CGPoint(x: leftWall, y: rect.maxY)
            )
        } else {
            path.addLine(to: CGPoint(x: leftWall, y: rect.maxY))
        }

        path.addLine(to: CGPoint(x: rightWall - bottomTrailing, y: rect.maxY))

        if bottomTrailing > 0 {
            path.addQuadCurve(
                to: CGPoint(x: rightWall, y: rect.maxY - bottomTrailing),
                control: CGPoint(x: rightWall, y: rect.maxY)
            )
        } else {
            path.addLine(to: CGPoint(x: rightWall, y: rect.maxY))
        }

        path.addLine(to: CGPoint(x: rightWall, y: rect.minY + topTrailing))

        if topTrailing > 0 {
            path.addQuadCurve(
                to: CGPoint(x: rect.maxX, y: rect.minY),
                control: CGPoint(x: rightWall, y: rect.minY)
            )
        } else {
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        }

        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
        path.closeSubpath()

        return path
    }

    /// 普通圆角矩形。没有刘海的机器上用。
    private func inwardPath(
        _ rect: CGRect,
        _ topLeading: CGFloat,
        _ topTrailing: CGFloat,
        _ bottomLeading: CGFloat,
        _ bottomTrailing: CGFloat
    ) -> Path {
        var path = Path()

        path.move(to: CGPoint(x: rect.minX + topLeading, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - topTrailing, y: rect.minY))

        if topTrailing > 0 {
            path.addArc(
                center: CGPoint(x: rect.maxX - topTrailing, y: rect.minY + topTrailing),
                radius: topTrailing,
                startAngle: .degrees(-90),
                endAngle: .degrees(0),
                clockwise: false
            )
        }

        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - bottomTrailing))

        if bottomTrailing > 0 {
            path.addArc(
                center: CGPoint(x: rect.maxX - bottomTrailing, y: rect.maxY - bottomTrailing),
                radius: bottomTrailing,
                startAngle: .degrees(0),
                endAngle: .degrees(90),
                clockwise: false
            )
        }

        path.addLine(to: CGPoint(x: rect.minX + bottomLeading, y: rect.maxY))

        if bottomLeading > 0 {
            path.addArc(
                center: CGPoint(x: rect.minX + bottomLeading, y: rect.maxY - bottomLeading),
                radius: bottomLeading,
                startAngle: .degrees(90),
                endAngle: .degrees(180),
                clockwise: false
            )
        }

        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + topLeading))

        if topLeading > 0 {
            path.addArc(
                center: CGPoint(x: rect.minX + topLeading, y: rect.minY + topLeading),
                radius: topLeading,
                startAngle: .degrees(180),
                endAngle: .degrees(270),
                clockwise: false
            )
        }

        path.closeSubpath()

        return path
    }
}
