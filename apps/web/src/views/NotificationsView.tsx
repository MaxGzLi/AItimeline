import { BadgeCheck } from "lucide-react";
import { t } from "../lib/i18n";
import type { AgentNotification } from "../lib/types";

export function NotificationsView({
  notifications,
  onOpenCardId,
  onSelect,
  selectedId
}: {
  notifications: AgentNotification[];
  onOpenCardId: (cardId: string) => void;
  onSelect: (notification: AgentNotification) => void;
  selectedId: string | null;
}) {
  const selected = notifications.find((notification) => notification.id === selectedId) ?? notifications[0];

  if (!notifications.length) {
    return <p className="x-empty">{t("notifications.empty")}</p>;
  }

  return (
    <section className="x-notifications" aria-label={t("notifications.label")}>
      <div className="x-notification-list">
        {notifications.map((notification) => (
          <button
            className={`x-notification-item${selected?.id === notification.id ? " active" : ""}`}
            key={notification.id}
            onClick={() => onSelect(notification)}
            type="button"
          >
            <span className="x-name">
              {notification.kind === "agent_answer"
                ? t("notifications.kind.agentAnswer")
                : t("notifications.kind.researchProgress")}
            </span>
            {!notification.readAt ? <span className="x-navdot inline" /> : null}
            <span className="x-meta">{new Date(notification.createdAt).toLocaleString()}</span>
            <span className="x-qtext">{notification.question ?? notification.body}</span>
          </button>
        ))}
      </div>

      {selected ? (
        <article className="x-post x-notification-detail">
          <span className="x-avatar agent" aria-hidden="true">
            AI
          </span>
          <div className="x-post-main">
            <div className="x-head">
              <span className="x-name">{t("notifications.detailTitle")}</span>
              <BadgeCheck aria-label={t("post.hasSource")} className="x-verified" size={17} />
              <span className="x-meta">·</span>
              <span className="x-meta">{new Date(selected.createdAt).toLocaleString()}</span>
            </div>
            {selected.question ? <p className="x-meta">{selected.question}</p> : null}
            <p className="x-body">{selected.body}</p>

            {selected.citations?.length ? (
              <div className="x-quote" role="note">
                <span className="x-qhead">
                  <span className="x-name">{t("agent.citationLabel")}</span>
                  <span className="x-meta">· {selected.citations[0]?.sourceTitle}</span>
                </span>
                <p className="x-qtext">"{selected.citations[0]?.quote}"</p>
              </div>
            ) : null}

            {selected.supportPosts?.length ? (
              <div className="x-support-list" role="list" aria-label={t("notifications.supportCards")}>
                {selected.supportPosts.map((post) => (
                  <button className="x-hint" key={post.id} onClick={() => onOpenCardId(post.id)} type="button">
                    {post.title}
                    {post.dismissed ? <span className="x-meta"> · {t("notifications.cardDismissed")}</span> : null}
                    {post.missing ? <span className="x-meta"> · {t("notifications.cardMissing")}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </article>
      ) : null}
    </section>
  );
}
