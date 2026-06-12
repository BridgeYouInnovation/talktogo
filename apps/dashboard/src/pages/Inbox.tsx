import { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import {
  countryFlag,
  timeAgo,
  visitorLabel,
  type Conversation,
  type Message,
} from "../lib/types";
import type { SiteContext } from "./SiteLayout";

export default function Inbox() {
  const { site, messagesSignal } = useOutletContext<SiteContext>();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("c");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [visitorTyping, setVisitorTyping] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimer = useRef<number | null>(null);
  const lastTypingSent = useRef(0);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  const fetchConversations = useCallback(async () => {
    const { data } = await supabase
      .from("conversations")
      .select("*, visitors(*)")
      .eq("site_id", site.id)
      .order("last_message_at", { ascending: false });
    setConversations((data as Conversation[]) ?? []);
    setLoadingConvs(false);
  }, [site.id]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations, messagesSignal]);

  // Load message history + subscribe to the selected conversation.
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;

    supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", selectedId)
      .order("created_at", { ascending: true })
      .limit(500)
      .then(({ data }) => {
        if (!cancelled) setMessages((data as Message[]) ?? []);
      });

    supabase.rpc("agent_mark_read", { p_conversation_id: selectedId }).then(() => {
      setConversations((prev) =>
        prev.map((c) => (c.id === selectedId ? { ...c, agent_unread_count: 0 } : c))
      );
    });

    const channel = supabase
      .channel(`conv:${selectedId}`)
      .on("broadcast", { event: "message" }, ({ payload }) => {
        if (payload?.sender_type === "visitor") {
          setVisitorTyping(false);
          setMessages((prev) => {
            if (payload.id && prev.some((m) => m.id === payload.id)) return prev;
            return [
              ...prev,
              {
                id: payload.id ?? `rt_${Date.now()}`,
                conversation_id: selectedId,
                site_id: site.id,
                sender_type: "visitor",
                agent_id: null,
                body: String(payload.body ?? ""),
                created_at: payload.created_at ?? new Date().toISOString(),
              },
            ];
          });
          supabase.rpc("agent_mark_read", { p_conversation_id: selectedId }).then(() => {});
        }
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload?.from === "visitor") {
          setVisitorTyping(true);
          if (typingTimer.current) window.clearTimeout(typingTimer.current);
          typingTimer.current = window.setTimeout(() => setVisitorTyping(false), 4000);
        }
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      channelRef.current = null;
      setMessages([]);
      setVisitorTyping(false);
    };
  }, [selectedId, site.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, visitorTyping]);

  async function sendReply() {
    const body = draft.trim();
    if (!body || !selectedId) return;
    setSending(true);
    setDraft("");

    const { data, error } = await supabase.rpc("agent_send_message", {
      p_conversation_id: selectedId,
      p_body: body,
    });
    setSending(false);
    if (error) {
      setDraft(body);
      return;
    }

    const message: Message = {
      id: data?.id ?? `local_${Date.now()}`,
      conversation_id: selectedId,
      site_id: site.id,
      sender_type: "agent",
      agent_id: null,
      body,
      created_at: data?.created_at ?? new Date().toISOString(),
    };
    setMessages((prev) => [...prev, message]);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? { ...c, last_message_preview: body, last_message_at: message.created_at }
          : c
      )
    );

    // Deliver to the visitor's widget in realtime.
    channelRef.current?.send({
      type: "broadcast",
      event: "message",
      payload: {
        id: message.id,
        sender_type: "agent",
        body,
        created_at: message.created_at,
      },
    });
  }

  function sendTyping() {
    const now = Date.now();
    if (now - lastTypingSent.current < 2000) return;
    lastTypingSent.current = now;
    channelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { from: "agent" },
    });
  }

  const v = selected?.visitors;

  return (
    <div className="inbox-layout">
      <aside className={`conv-list ${selectedId ? "hidden-mobile" : ""}`}>
        <div className="conv-list-head">Conversations</div>
        {loadingConvs ? (
          <div className="center-screen" style={{ height: 160 }}>
            <div className="spinner" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="empty-state">
            <p>No conversations yet.</p>
            <p style={{ fontSize: 13 }}>
              When a visitor sends a message from your widget it will appear here instantly.
            </p>
          </div>
        ) : (
          conversations.map((c) => (
            <button
              key={c.id}
              className={`conv-item ${c.id === selectedId ? "active" : ""}`}
              onClick={() => setParams({ c: c.id })}
            >
              <div className="conv-avatar">
                {visitorLabel(c.visitors).charAt(0).toUpperCase()}
                <span className={`online-dot ${c.visitors?.online ? "" : "off"}`} />
              </div>
              <div className="conv-body">
                <div className="conv-top">
                  <span className="conv-name">
                    {countryFlag(c.visitors?.country_code)} {visitorLabel(c.visitors)}
                    {c.agent_unread_count > 0 && (
                      <span className="unread-pill">{c.agent_unread_count}</span>
                    )}
                  </span>
                  <span className="conv-time">{timeAgo(c.last_message_at)}</span>
                </div>
                <div className="conv-preview">{c.last_message_preview ?? "New conversation"}</div>
              </div>
            </button>
          ))
        )}
      </aside>

      <section className={`chat-pane ${selectedId ? "" : "hidden-mobile"}`}>
        {!selected ? (
          <div className="chat-empty">
            <div style={{ fontSize: 40 }}>💬</div>
            <p>Select a conversation to start chatting</p>
          </div>
        ) : (
          <>
            <div className="chat-head">
              <div className="conv-avatar">
                {visitorLabel(v).charAt(0).toUpperCase()}
                <span className={`online-dot ${v?.online ? "" : "off"}`} />
              </div>
              <div className="info">
                <div className="name">
                  {countryFlag(v?.country_code)} {visitorLabel(v)}
                </div>
                <div className="detail">
                  {[
                    v?.online ? "Online now" : v?.last_seen_at ? `Last seen ${timeAgo(v.last_seen_at)}` : null,
                    v?.country ? `${v.country}${v.city ? `, ${v.city}` : ""}` : null,
                    v?.current_page ? `On ${v.current_page}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            </div>

            <div className="chat-messages">
              {messages.map((m) => (
                <div key={m.id} className={`bubble-row ${m.sender_type}`}>
                  <div className="bubble">
                    {m.body}
                    <span className="time">
                      {new Date(m.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {visitorTyping && <div className="typing-note">Visitor is typing…</div>}

            <div className="chat-input-row">
              <textarea
                rows={1}
                placeholder="Type your reply…"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  sendTyping();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendReply();
                  }
                }}
              />
              <button className="btn" onClick={sendReply} disabled={sending || !draft.trim()}>
                Send
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
