import AppKit
import SwiftUI

/// 应用入口。没有主窗口、不进 Dock(`LSUIElement`),只有刘海和一个菜单栏图标。
@main
struct NotchApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()

        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var windowController: IslandWindowController?
    private var statusItem: NSStatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        MainActor.assumeIsolated {
            let controller = IslandWindowController(appState: AppState.shared)

            controller.start()
            windowController = controller

            CardStore.shared.start()
            setUpStatusItem()
        }
    }

    /// 菜单栏留一个图标,否则这个应用装上之后没有任何地方能退出它。
    @MainActor
    private func setUpStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        item.button?.image = NSImage(
            systemSymbolName: "book.closed",
            accessibilityDescription: "AITimeline"
        )

        let menu = NSMenu()

        menu.addItem(
            withTitle: "刷新知识卡",
            action: #selector(refreshCards),
            keyEquivalent: "r"
        ).target = self

        let displayItem = menu.addItem(withTitle: "显示在", action: nil, keyEquivalent: "")
        displayItem.submenu = makeDisplayMenu()

        menu.addItem(.separator())
        menu.addItem(
            withTitle: "退出 AITimeline",
            action: #selector(quit),
            keyEquivalent: "q"
        ).target = self

        item.menu = menu
        statusItem = item
    }

    /// 「显示在」子菜单。内容由 `menuNeedsUpdate` 在每次弹出前填 ——
    /// 建一次就不管的话,插拔屏之后这份清单是旧的。
    @MainActor
    private func makeDisplayMenu() -> NSMenu {
        let menu = NSMenu()

        menu.delegate = self

        return menu
    }

    @objc private func pickDisplay(_ sender: NSMenuItem) {
        MainActor.assumeIsolated {
            let identifier = sender.representedObject as? String ?? ""

            if identifier.isEmpty {
                UserDefaults.standard.removeObject(forKey: ScreenDetector.displayPreferenceKey)
            } else {
                UserDefaults.standard.set(identifier, forKey: ScreenDetector.displayPreferenceKey)
            }

            windowController?.relocate()
        }
    }

    @objc private func refreshCards() {
        Task { @MainActor in await CardStore.shared.refresh() }
    }

    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }
}

extension AppDelegate: NSMenuDelegate {
    /// 屏幕清单每次弹出前重建。插拔屏之后不重建的话,菜单里还是旧的那几块。
    func menuNeedsUpdate(_ menu: NSMenu) {
        MainActor.assumeIsolated {
            let current = UserDefaults.standard.string(forKey: ScreenDetector.displayPreferenceKey) ?? ""

            menu.removeAllItems()

            let auto = menu.addItem(withTitle: "自动(跟主显示器)", action: #selector(pickDisplay(_:)), keyEquivalent: "")
            auto.target = self
            auto.representedObject = ""
            auto.state = current.isEmpty ? .on : .off

            menu.addItem(.separator())

            for screen in ScreenDetector.availableScreens() {
                let item = menu.addItem(withTitle: screen.name, action: #selector(pickDisplay(_:)), keyEquivalent: "")

                item.target = self
                item.representedObject = screen.id
                item.state = current == screen.id ? .on : .off
            }
        }
    }
}
