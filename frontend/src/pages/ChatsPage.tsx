import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import ChatView from "../components/ChatView";
import ConversationList from "../components/ConversationList";
import DetailsPanel from "../components/DetailsPanel";
import { EmptyState, Spinner } from "../components/ui";
import { useChat } from "../context/ChatContext";

export default function ChatsPage() {
  const { id } = useParams();
  const { conversations, conversationsLoaded, setActive } = useChat();
  const [details, setDetails] = useState(false);
  const conversation = id ? conversations.find((c) => c.id === id) : undefined;

  useEffect(() => { setActive(id ?? null); return () => setActive(null); }, [id, setActive]);
  useEffect(() => setDetails(false), [id]);

  return (
    <div className="flex h-full min-h-0 md:gap-3">
      {/* Mobile: list OR conversation (full screen). Desktop: both side by side. */}
      <div className={`${id ? "hidden md:block" : "block"} h-full w-full shrink-0 md:w-[22rem]`}><ConversationList /></div>
      <div className={`${id ? "block" : "hidden md:block"} h-full min-w-0 flex-1`}>
        {!id ? (
          <div className="glass hidden h-full flex-col md:flex md:rounded-3xl">
            <EmptyState icon={<MessageSquare className="h-7 w-7" />} title="Pick a conversation">Choose a chat from the list, or add someone new in Contacts.</EmptyState>
          </div>
        ) : conversation ? (
          <div className="flex h-full min-h-0 md:gap-3">
            <div className="h-full min-w-0 flex-1"><ChatView conversation={conversation} onToggleDetails={() => setDetails((d) => !d)} /></div>
            {details && <DetailsPanel conversation={conversation} onClose={() => setDetails(false)} />}
          </div>
        ) : !conversationsLoaded ? <Spinner label="Opening chat" /> : (
          <div className="glass flex h-full flex-col md:rounded-3xl">
            <EmptyState icon={<MessageSquare className="h-7 w-7" />} title="Conversation not found">It may have been removed. <Link className="text-accent underline" to="/chats">Back to chats</Link></EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}
