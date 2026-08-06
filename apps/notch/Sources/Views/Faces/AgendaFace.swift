import AppKit
import SwiftUI

/// 日程面:左边月历 + 选中那天的安排,右边现在几点 + 往后几天。
///
/// 骨架跟别的面一样(左栏 / 竖线 / 右 236)。左栏 531 里再切一刀:
/// 月历 246 / 竖线 / 当天的事,这样一屏就答完了「今天什么时候有空」。
struct AgendaFace: View {
    @EnvironmentObject private var appState: AppState
    @ObservedObject private var agenda = AgendaStore.shared

    private let sidePadding = Constants.fullExpandedSidePadding
    private let columnGap: CGFloat = 20
    private let sideWidth: CGFloat = 236
    private let gridWidth: CGFloat = 246

    var body: some View {
        VStack(spacing: 0) {
            columns
                .padding(.horizontal, sidePadding)
                .padding(.top, 12)
                .frame(maxHeight: .infinity, alignment: .top)

            footer
                .padding(.horizontal, sidePadding)
        }
        .task {
            await agenda.requestAccess()
        }
        .onAppear {
            agenda.refreshAccess()
        }
    }

    private var columns: some View {
        let total = appState.currentSize.width - sidePadding * 2
        let main = max(320, total - columnGap * 2 - 1 - sideWidth)

        return HStack(spacing: 0) {
            mainColumn
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

    @ViewBuilder
    private var mainColumn: some View {
        if agenda.access == .granted {
            HStack(spacing: 0) {
                monthGrid
                    .frame(width: gridWidth)

                Spacer()
                    .frame(width: 18)

                Rectangle()
                    .fill(NotchSurface.hairline)
                    .frame(width: 1)
                    .padding(.vertical, 4)

                Spacer()
                    .frame(width: 18)

                dayColumn
            }
        } else {
            permission
        }
    }

    // MARK: - 没权限

    private var permission: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()

            Text(agenda.access == .denied ? "系统不让我读日历" : "要读一下系统日历")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(NotchInk.body)

            Spacer().frame(height: 6)

            Text(agenda.access == .denied
                ? "在「系统设置 › 隐私与安全性 › 日历」里把 AITimeline 打开,回来这块就有东西了。"
                : "只读,不改也不发。日程和你的知识卡一样待在本机。")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(NotchInk.faint)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 380, alignment: .leading)

            Spacer().frame(height: 14)

            // 拒了之后系统不会再弹第二次,只能自己去设置里开 —— 那就把路给到脚下。
            Button(agenda.access == .denied ? "去设置里打开" : "现在就问我要") {
                if agenda.access == .denied {
                    NSWorkspace.shared.open(Self.calendarSettings)
                } else {
                    Task { await agenda.requestAccess() }
                }
            }
            .buttonStyle(.plain)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(.white.opacity(0.88))
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(Capsule().fill(.white.opacity(0.10)))
            .hoverPointer()

            Spacer()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private static let calendarSettings = URL(
        string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars"
    )!

    // MARK: - 月历

    private var monthGrid: some View {
        let cells = agenda.monthGrid
        let rows = max(1, cells.count / 7)

        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text(AgendaStore.label(agenda.visibleMonth, "yMMMM"))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(NotchInk.body)

                Spacer(minLength: 8)

                step("chevron.left", -1)
                step("chevron.right", 1)
            }
            .frame(height: 22)

            Spacer().frame(height: 8)

            HStack(spacing: 3) {
                ForEach(Array(agenda.weekdaySymbols.enumerated()), id: \.offset) { _, symbol in
                    Text(symbol)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(.white.opacity(0.42))
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 12)

            Spacer().frame(height: 5)

            // 格子高度按剩下的地方算,不写死 —— 月份跨 5 行还是 6 行是会变的。
            VStack(spacing: 3) {
                ForEach(0..<rows, id: \.self) { row in
                    HStack(spacing: 3) {
                        ForEach(0..<7, id: \.self) { column in
                            cell(cells[safe: row * 7 + column] ?? nil)
                        }
                    }
                }
            }

            Spacer(minLength: 0)
        }
    }

    private func step(_ symbol: String, _ delta: Int) -> some View {
        Button {
            agenda.stepMonth(delta)
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(.white.opacity(0.72))
                .frame(width: 20, height: 20)
                .background(Circle().fill(.white.opacity(0.07)))
        }
        .buttonStyle(.plain)
        .hoverPointer()
    }

    @ViewBuilder
    private func cell(_ day: Date?) -> some View {
        if let day {
            let calendar = Calendar.current
            let isToday = calendar.isDateInToday(day)
            let isPicked = calendar.isDate(day, inSameDayAs: agenda.selectedDay)
            let busy = agenda.busyDays.contains(calendar.startOfDay(for: day))

            Button {
                agenda.select(day: day)
            } label: {
                VStack(spacing: 2) {
                    Text("\(calendar.component(.day, from: day))")
                        .font(.system(size: 11, weight: isToday || isPicked ? .semibold : .regular))
                        .monospacedDigit()
                        .foregroundStyle(.white.opacity(isPicked || isToday ? 0.95 : 0.62))

                    Circle()
                        .fill(.white.opacity(busy ? 0.42 : 0))
                        .frame(width: 4, height: 4)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 30)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(.white.opacity(isPicked ? 0.14 : isToday ? 0.06 : 0))
                )
            }
            .buttonStyle(.plain)
            .hoverPointer()
        } else {
            Color.clear
                .frame(maxWidth: .infinity)
                .frame(height: 30)
        }
    }

    // MARK: - 选中那天

    private var dayColumn: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text(dayTitle)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(NotchInk.body)

                Text(agenda.dayEvents.isEmpty ? "" : "\(agenda.dayEvents.count) 件")
                    .font(.system(size: 10, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(NotchInk.label)

                Spacer(minLength: 0)
            }
            .frame(height: 22)

            Spacer().frame(height: 8)

            if agenda.dayEvents.isEmpty {
                Text("这天没安排")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.white.opacity(0.38))

                Spacer(minLength: 0)
            } else {
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: 2) {
                        ForEach(agenda.dayEvents) { event in
                            row(event)
                        }
                    }
                    .padding(.bottom, 10)
                }
                .mask(
                    LinearGradient(
                        stops: [
                            .init(color: .black, location: 0),
                            .init(color: .black, location: 0.90),
                            .init(color: .clear, location: 1.0)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
            }
        }
    }

    private func row(_ event: AgendaEvent) -> some View {
        let live = event.start <= agenda.now && event.end > agenda.now

        return HStack(alignment: .top, spacing: 8) {
            RoundedRectangle(cornerRadius: 1.5)
                .fill(event.tint.opacity(0.85))
                .frame(width: 3, height: 28)
                .padding(.top, 3)

            VStack(alignment: .leading, spacing: 2) {
                Text(event.title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(NotchInk.read)
                    .lineLimit(1)

                Text(event.location.map { "\(event.timeLabel) · \($0)" } ?? event.timeLabel)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(NotchInk.faint)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            if live {
                Text("进行中")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.white.opacity(0.55))
                    .padding(.top, 1)
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(.white.opacity(live ? 0.05 : 0))
        )
    }

    private var dayTitle: String {
        let calendar = Calendar.current

        if calendar.isDateInToday(agenda.selectedDay) { return "今天" }
        if calendar.isDateInTomorrow(agenda.selectedDay) { return "明天" }
        if calendar.isDateInYesterday(agenda.selectedDay) { return "昨天" }

        return AgendaStore.label(agenda.selectedDay, "MMMd")
    }

    // MARK: - 右栏:现在几点 + 往后几天

    private var sideColumn: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(AgendaStore.hhmm(agenda.now))
                .font(.system(size: 40, weight: .medium, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(NotchInk.title)

            Text(AgendaStore.label(agenda.now, "EEEEMMMd"))
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(NotchInk.faint)

            Spacer().frame(height: 6)

            if let next = agenda.nextEvent {
                Rectangle()
                    .fill(NotchSurface.hairline)
                    .frame(height: 1)

                Spacer().frame(height: 8)

                Text(next.countdown(from: agenda.now))
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(NotchInk.label)

                Spacer().frame(height: 3)

                Text(next.title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(NotchInk.read)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 14)

            Rectangle()
                .fill(NotchSurface.hairline)
                .frame(height: 1)

            Spacer().frame(height: 10)

            Text("往后七天")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(NotchInk.label)

            Spacer().frame(height: 6)

            upcomingList
        }
    }

    @ViewBuilder
    private var upcomingList: some View {
        if agenda.upcoming.isEmpty {
            Text(agenda.access == .granted ? "这一周空着" : "看不到")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.34))
        } else {
            VStack(alignment: .leading, spacing: 6) {
                // 只放头四条。右栏就这么高,排满了就成了一堵字墙。
                ForEach(agenda.upcoming.prefix(4)) { event in
                    HStack(spacing: 6) {
                        RoundedRectangle(cornerRadius: 1)
                            .fill(event.tint.opacity(0.8))
                            .frame(width: 2, height: 14)

                        VStack(alignment: .leading, spacing: 1) {
                            Text(event.title)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(.white.opacity(0.74))
                                .lineLimit(1)

                            Text("\(AgendaStore.label(event.start, "EEEd")) · \(event.timeLabel)")
                                .font(.system(size: 9, weight: .medium))
                                .foregroundStyle(.white.opacity(0.34))
                                .lineLimit(1)
                        }

                        Spacer(minLength: 0)
                    }
                }

                if agenda.upcoming.count > 4 {
                    Text("还有 \(agenda.upcoming.count - 4) 件")
                        .font(.system(size: 9, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(.white.opacity(0.28))
                }
            }
        }
    }

    // MARK: - 底通栏

    private var footer: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(NotchSurface.hairline)
                .frame(height: 1)

            HStack(spacing: 20) {
                Text(agenda.access == .granted ? "读的是系统日历,只读" : "还没拿到日历权限")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.45))

                Spacer(minLength: 12)

                if !Calendar.current.isDateInToday(agenda.selectedDay) {
                    Button("回到今天") {
                        agenda.backToToday()
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(NotchInk.meta)
                    .hoverPointer()
                }
            }
            .frame(height: 15)
            .padding(.vertical, 12)
        }
        .frame(height: 40)
    }
}

/// 日程面在肩栏右翼放的东西:下一件事还有多久。
struct AgendaShoulderTrailing: View {
    @ObservedObject private var agenda = AgendaStore.shared

    var body: some View {
        HStack(spacing: 12) {
            Spacer(minLength: 0)

            if let next = agenda.nextEvent {
                Text(next.title)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(NotchInk.weak)
                    .lineLimit(1)

                Text(next.countdown(from: agenda.now))
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(NotchInk.ghost)
            } else {
                Text(AgendaStore.hhmm(agenda.now))
                    .font(.system(size: 10, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(NotchInk.ghost)
            }
        }
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
