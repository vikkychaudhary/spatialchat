import { MessageSquare, Settings, Users } from "lucide-react";
import { NavLink, Outlet, useMatch } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { Avatar, ConnectionBanner } from "./ui";

function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return <span className="absolute -right-1 -top-1 min-w-[1.25rem] rounded-full bg-strong px-1 text-center text-[11px] font-bold leading-5 text-white" aria-hidden>{n > 99 ? "99+" : n}</span>;
}

export default function AppShell() {
  const { user } = useAuth();
  const { totalUnread, incoming } = useChat();
  const inConversation = !!useMatch("/chats/:id");
  const items = [
    { to: "/chats", label: "Chats", icon: MessageSquare, badge: totalUnread, sr: `${totalUnread} unread` },
    { to: "/contacts", label: "Contacts", icon: Users, badge: incoming.length, sr: `${incoming.length} pending requests` },
    { to: "/settings", label: "Settings", icon: Settings, badge: 0, sr: "" },
  ];
  const link = (isActive: boolean) => `relative flex flex-col items-center justify-center gap-0.5 rounded-2xl text-xs font-medium transition-colors min-h-touch min-w-touch ${isActive ? "bg-strong/25 text-ink" : "text-muted hover:bg-line/10 hover:text-ink"}`;
  return (
    <div className="flex flex-col" style={{ height: "var(--app-h, 100dvh)" }}>
      <ConnectionBanner />
      <div className="flex min-h-0 flex-1 md:gap-3 md:p-3 safe-x">
        {/* Desktop navigation rail */}
        <nav aria-label="Main" className="glass hidden w-[76px] shrink-0 flex-col items-center gap-2 rounded-3xl py-4 md:flex">
          <NavLink to="/settings" aria-label={`Your profile: ${user?.displayName}`} className="mb-3 rounded-full">
            <Avatar name={user?.displayName ?? "?"} color={user?.avatarColor ?? "#6366f1"} size={46} />
          </NavLink>
          {items.map(({ to, label, icon: Icon, badge, sr }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `${link(isActive)} h-16 w-16`}>
              <Icon aria-hidden className="h-5 w-5" />
              {label}
              <Badge n={badge} />
              {badge > 0 && <span className="sr-only">{sr}</span>}
            </NavLink>
          ))}
        </nav>
        <main className="min-h-0 min-w-0 flex-1"><Outlet /></main>
      </div>
      {/* Mobile bottom navigation (hidden inside an open conversation to maximise space) */}
      {!inConversation && (
        <nav aria-label="Main" className="glass safe-b grid grid-cols-3 gap-1 border-x-0 border-b-0 px-2 pt-1 md:hidden">
          {items.map(({ to, label, icon: Icon, badge, sr }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `${link(isActive)} py-1.5`}>
              <Icon aria-hidden className="h-5 w-5" />
              {label}
              <Badge n={badge} />
              {badge > 0 && <span className="sr-only">{sr}</span>}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
