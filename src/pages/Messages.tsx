// ============================================================================
// PAGE: Messages.tsx - Messagerie et conversations de groupe
// ============================================================================
//
// Cette page fournit une interface de messagerie complète, incluant:
// 1. Conversations directes avec d'autres utilisateurs
// 2. Conversations de groupe
// 3. Envoi et réception de messages en temps réel
// 4. Appels vidéo et vocaux directs
// 5. Créer de nouveaux groupes
// 6. Afficher la présence des utilisateurs (en ligne/hors ligne)
// 7. Marquer les messages comme lus
// 8. Supprimer les conversations
// 9. Rechercher les conversations
//
// UTILISE LES CONTEXTES:
// - MessagesContext: Gestion des conversations et messages
// - GroupsContext: Gestion des groupes de chat
// - AuthContext: Utilisateur actuellement authentifié
// - useContactPresence: Statut en ligne des contacts
//
// FONCTIONNALITÉS EN TEMPS RÉEL:
// - Listeners Firestore pour les nouveaux messages
// - Mise à jour de la présence des utilisateurs
// - Synchronisation des conversations avec le serveur
// - Notifications des messages non lus

import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMessages, Conversation } from '@/context/MessagesContext';
import { useGroups } from '@/context/GroupsContext';
import { useAuth } from '@/context/AuthContext';
import { useContactPresence } from '@/hooks/useContactPresence';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowLeft, Plus, Send, Phone, Video, Search, Settings, X, CheckCheck, Clock, MessageSquare, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Timestamp, collection, query, where, getDocs, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase/firebase';
import CreateGroupDialog from '@/components/CreateGroupDialog';
import GroupChatView from '@/components/GroupChatView';

const Messages = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const {
    conversations,
    currentConversation,
    setCurrentConversation,
    sendMessage,
    conversationsLoading,
    messages,
    loadConversationMessages,
    deleteConversation,
    createDirectConversation,
  } = useMessages();
  const { groups } = useGroups();
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [contactNames, setContactNames] = useState<Map<string, string>>(new Map());
  const [groupDetailsOpen, setGroupDetailsOpen] = useState(false);
  const [contactPresenceMap, setContactPresenceMap] = useState<Map<string, boolean>>(new Map());
  const [contacts, setContacts] = useState<Array<{id: string; invitId: string; name: string; email: string}>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Get participant presence for direct messages
  useEffect(() => {
    const presenceMap = new Map(contactPresenceMap);
    
    if (currentConversation?.type === 'direct' && currentConversation?.participantIds) {
      const otherUserId = currentConversation.participantIds.find(id => id !== user?.uid);
      if (otherUserId) {
        const profileRef = doc(db, 'publicProfiles', otherUserId);
        const unsubscribe = onSnapshot(profileRef, (doc) => {
          if (doc.exists()) {
            const isOnline = doc.data().isOnline || false;
            presenceMap.set(otherUserId, isOnline);
            setContactPresenceMap(new Map(presenceMap));
          }
        });
        return () => unsubscribe();
      }
    }
  }, [currentConversation?.id, currentConversation?.type, currentConversation?.participantIds, user?.uid]);

  // Load all contacts
  useEffect(() => {
    const unsubscribePresence: (() => void)[] = [];
    const loadContacts = async () => {
      if (!user) return;

      try {
        const contactsQuery = query(
          collection(db, 'contacts'),
          where('creatorId', '==', user.uid)
        );
        const contactDocs = await getDocs(contactsQuery);

        const loadedContacts = contactDocs.docs.map(doc => ({
          id: doc.id,
          invitId: doc.data().invitId,
          name: doc.data().displayName || doc.data().name || 'Sans nom',
          email: doc.data().email || '',
        }));

        setContacts(loadedContacts);

        // Subscribe to presence for all contacts
        const presenceMap = new Map(contactPresenceMap);
        for (const contact of loadedContacts) {
          const profileRef = doc(db, 'publicProfiles', contact.invitId);
          const unsubscribe = onSnapshot(profileRef, (docSnap) => {
            if (docSnap.exists()) {
              const isOnline = docSnap.data().isOnline || false;
              presenceMap.set(contact.invitId, isOnline);
              setContactPresenceMap(new Map(presenceMap));
            }
          });
          unsubscribePresence.push(unsubscribe);
        }
      } catch (error) {
        console.error('Failed to load contacts:', error);
      }
    };

    if (user) {
      loadContacts();
    }
    return () => unsubscribePresence.forEach((unsubscribe) => unsubscribe());
  }, [user]);

  // Fetch contact names for display
  useEffect(() => {
    let cancelled = false;

    const fetchContactNames = async () => {
      const names = new Map<string, string>();

      for (const conv of conversations) {
        if (conv.type === 'direct' && conv.participantIds) {
          const otherUserId = conv.participantIds.find(id => id !== user?.uid);
          if (otherUserId && !names.has(otherUserId)) {
            if (contactNames.has(otherUserId)) continue;
            try {
              const contactsQuery = query(
                collection(db, 'contacts'),
                where('creatorId', '==', user?.uid),
                where('invitId', '==', otherUserId)
              );
              const contactDocs = await getDocs(contactsQuery);

              if (!contactDocs.empty) {
                const contactName = contactDocs.docs[0].data().displayName || contactDocs.docs[0].data().name || 'Sans nom';
                names.set(otherUserId, contactName);
              } else {
                const profileDoc = await getDoc(doc(db, 'publicProfiles', otherUserId));
                if (profileDoc.exists()) {
                  const profileName = profileDoc.data().displayName || profileDoc.data().email || otherUserId;
                  names.set(otherUserId, profileName);
                } else {
                  names.set(otherUserId, 'Sans nom');
                }
              }
            } catch (error) {
              console.warn(`Failed to fetch name for ${otherUserId}:`, error);
              names.set(otherUserId, 'Sans nom');
            }
          }
        }
      }

      if (!cancelled && names.size > 0) {
        setContactNames((current) => {
          let hasNewNames = false;
          const next = new Map(current);
          names.forEach((name, id) => {
            if (!next.has(id)) {
              next.set(id, name);
              hasNewNames = true;
            }
          });
          return hasNewNames ? next : current;
        });
      }
    };

    if (user && conversations.length > 0) {
      void fetchContactNames();
    }
    return () => { cancelled = true; };
  }, [conversations, user, contactNames]);

  // Auto-select conversation when navigating
  useEffect(() => {
    const state = location.state as { conversationId?: string } | null;
    if (state?.conversationId && conversations.length > 0) {
      const conversation = conversations.find(c => c.id === state.conversationId);
      if (conversation) {
        setCurrentConversation(conversation);
      }
    }
  }, [location.state, conversations, setCurrentConversation]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load messages when conversation changes
  useEffect(() => {
    if (currentConversation?.id) {
      loadConversationMessages(currentConversation.id);
    }
  }, [currentConversation?.id, loadConversationMessages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentConversation?.id || !messageInput.trim() || !user) {
      toast.error('Sélectionnez une conversation valide');
      return;
    }

    setSendingMessage(true);
    try {
      await sendMessage(currentConversation.id, messageInput);
      setMessageInput('');
    } catch (error) {
      console.error('Failed to send message:', error);
      toast.error('Erreur lors de l\'envoi du message');
    } finally {
      setSendingMessage(false);
    }
  };

  const handleStartDirectCall = async () => {
    if (!currentConversation?.id || currentConversation.type !== 'direct') {
      toast.error('Sélectionnez une conversation directe valide');
      return;
    }

    const otherUserId = currentConversation.participantIds.find((id) => id !== user?.uid);
    if (!otherUserId) {
      toast.error('Impossible de trouver le destinataire');
      return;
    }

    navigate(`/invitations/new?targetUserId=${otherUserId}`);
  };

  const handleStartGroupCall = async () => {
    if (!currentConversation?.id || currentConversation.type !== 'group') {
      toast.error('Sélectionnez un groupe valide');
      return;
    }

    const selectedGroup = groups.find((g) => g.conversationId === currentConversation.id);
    if (!selectedGroup?.id) {
      toast.error('Groupe non trouvé');
      return;
    }

    navigate(`/group-call/new?groupId=${selectedGroup.id}`);
  };

  const handleLeaveGroupSuccess = () => {
    setCurrentConversation(null);
    setGroupDetailsOpen(false);
  };

  const handleStartDirectMessage = async (contactId: string) => {
    if (!user) {
      toast.error('Vous devez être connecté');
      return;
    }

    try {
      const conversation = await createDirectConversation(contactId);
      setCurrentConversation(conversation);
    } catch (error) {
      console.error('Error starting conversation:', error);
      toast.error('Impossible de démarrer la conversation');
    }
  };

  const formatTimestamp = (ts: Timestamp | Date | string | null | undefined) => {
    if (!ts) return '';
    try {
      const date = ts instanceof Timestamp ? ts.toDate() : ts instanceof Date ? ts : new Date(ts);
      return formatDistanceToNow(date, { addSuffix: true, locale: fr });
    } catch {
      return '';
    }
  };

  const getConversationName = (conv: Conversation) => {
    if (conv.type === 'group') {
      return conv.groupName || 'Groupe sans nom';
    }
    const otherUserId = conv.participantIds.find((id) => id !== user?.uid);
    if (!otherUserId) return 'Conversation';
    return contactNames.get(otherUserId) || conv.participantNames?.[0] || 'Sans nom';
  };

  // Search across conversations, groups, and contacts
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) {
      // Show all conversations and no contacts when search is empty
      return { conversations: conversations, contacts: [] };
    }

    const lowerQuery = searchQuery.toLowerCase();

    // Filter conversations and groups by name, objective, or participant names
    const filteredConversations = conversations.filter((conv) => {
      if (conv.type === 'group') {
        // Search in group name, objective, description, or participant names
        return (
          (conv.groupName?.toLowerCase().includes(lowerQuery)) ||
          (conv.groupObjective?.toLowerCase().includes(lowerQuery)) ||
          (conv.groupDescription?.toLowerCase().includes(lowerQuery)) ||
          (conv.participantNames?.some(name => name.toLowerCase().includes(lowerQuery)))
        );
      }
      // For direct messages, search in contact names and emails
      const conversationName = conv.participantNames?.join(' ').toLowerCase() || '';
      return conversationName.includes(lowerQuery);
    });

    // Filter contacts that don't have existing conversations
    const filteredContacts = contacts
      .filter(contact =>
        contact.name.toLowerCase().includes(lowerQuery) ||
        contact.email.toLowerCase().includes(lowerQuery)
      )
      .filter(contact => {
        // Don't show contacts that already have a conversation
        return !conversations.some(conv =>
          conv.type === 'direct' &&
          conv.participantIds.includes(contact.invitId)
        );
      });

    return { conversations: filteredConversations, contacts: filteredContacts };
  }, [conversations, searchQuery, contacts]);

  const handleSelectConversation = (conv: Conversation) => {
    setCurrentConversation(conv);
  };

  const handleDeleteConversation = async (conv: Conversation) => {
    if (!conv.id) return;

    toast('Supprimer la conversation ?', {
      description: 'Cette action est irréversible.',
      action: {
        label: "Supprimer",
        onClick: async () => {
          try {
            await deleteConversation(conv.id!);
            if (currentConversation?.id === conv.id) {
              setCurrentConversation(null);
            }
            toast.success('Conversation supprimée');
          } catch (error) {
            console.error('Error deleting conversation:', error);
            toast.error('Erreur lors de la suppression');
          }
        },
      },
      cancel: { label: "Annuler", onClick: () => {} },
      duration: 10000,
    });
  };

  const isGroupChat = currentConversation?.type === 'group';
  const otherUserId = currentConversation?.type === 'direct' 
    ? currentConversation?.participantIds.find((id) => id !== user?.uid)
    : null;
  const isOtherUserOnline = otherUserId ? contactPresenceMap.get(otherUserId) : false;

  return (
    <DashboardLayout>
      <div className="dashboard-surface landing-page mx-auto flex h-full min-h-[480px] w-full max-w-[1440px] min-w-0 overflow-hidden rounded-[1.5rem] border border-border/70 bg-background/55 shadow-sm">
        <aside className={"h-full min-h-0 w-full min-w-0 shrink-0 flex-col border-r border-border/70 bg-card/45 xl:w-[22rem] " + (currentConversation ? 'hidden xl:flex' : 'flex')}>
          <div className="border-b border-border/70 p-5 sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Espace de travail</p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Messages</h1>
                <p className="mt-1 text-sm text-muted-foreground">Vos conversations, au même endroit.</p>
              </div>
              <CreateGroupDialog open={showCreateGroup} onOpenChange={setShowCreateGroup}>
                <Button size="icon" variant="outline" className="h-10 w-10 shrink-0 rounded-xl" aria-label="Créer un groupe" title="Créer un groupe">
                  <Plus className="h-4 w-4" />
                </Button>
              </CreateGroupDialog>
            </div>
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Rechercher une conversation"
                className="h-11 rounded-xl border-border/70 bg-background/75 pl-10 text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Conversations List */}
          <ScrollArea className="min-h-0 w-full min-w-0 flex-1">
            <div className="min-w-0 space-y-1.5 p-3">
              {conversationsLoading ? (
                <div className="space-y-2 p-2 sm:p-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-[4.5rem] animate-pulse rounded-2xl border border-border/50 bg-muted/35" />
                  ))}
                </div>
              ) : searchResults.conversations.length === 0 && searchResults.contacts.length === 0 ? (
                <div className="mx-2 mt-8 rounded-2xl border border-dashed border-border/80 bg-background/45 px-5 py-8 text-center">
                  <div className="dashboard-empty-icon mx-auto flex h-12 w-12 items-center justify-center rounded-2xl">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <p className="mt-4 text-sm font-semibold text-foreground">Aucune conversation</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Recherchez un contact ou créez un groupe pour commencer.</p>
                </div>
              ) : (
                <>
                  {/* Conversations Section */}
                  {searchResults.conversations.length > 0 && (
                    <>
                      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Conversations</p>
                      {searchResults.conversations.map((conv) => (
                        <ConversationItem
                          key={conv.id}
                          conversation={conv}
                          isSelected={currentConversation?.id === conv.id}
                          onSelect={() => handleSelectConversation(conv)}
                          onDelete={() => handleDeleteConversation(conv)}
                          getConversationName={getConversationName}
                          formatTimestamp={formatTimestamp}
                          isOnline={
                            conv.type === 'direct'
                              ? contactPresenceMap.get(conv.participantIds.find(id => id !== user?.uid) || '')
                              : false
                          }
                        />
                      ))}
                    </>
                  )}

                  {/* Contacts Section */}
                  {searchResults.contacts.length > 0 && (
                    <>
                      <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Contacts</p>
                      {searchResults.contacts.map((contact) => (
                        <ContactSearchResult
                          key={contact.id}
                          contact={contact}
                          isOnline={contactPresenceMap.get(contact.invitId) || false}
                          onSelect={() => handleStartDirectMessage(contact.invitId)}
                        />
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </aside>

        <section className={"min-h-0 min-w-0 flex-1 flex-col bg-background/35 " + (currentConversation ? 'flex' : 'hidden xl:flex')}>
          {currentConversation ? (
            <>
              {/* Chat Header */}
              <ChatHeader
                conversation={currentConversation}
                getConversationName={getConversationName}
                isGroupChat={isGroupChat}
                isOnline={isOtherUserOnline}
                onStartDirectCall={handleStartDirectCall}
                onStartGroupCall={handleStartGroupCall}
                onOpenGroupDetails={() => setGroupDetailsOpen(true)}
                onBack={() => setCurrentConversation(null)}
              />

              {/* Messages Area */}
              <MessagesArea
                messages={messages}
                userId={user?.uid}
                formatTimestamp={formatTimestamp}
                messagesEndRef={messagesEndRef}
              />

              {/* Message Input */}
              <MessageInput
                value={messageInput}
                onChange={(value) => setMessageInput(value)}
                onSend={handleSendMessage}
                isDisabled={sendingMessage}
                isLoading={sendingMessage}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-muted-foreground">
              <div className="max-w-sm text-center">
                <div className="dashboard-tone-lavender mx-auto flex h-16 w-16 items-center justify-center rounded-[1.4rem]">
                  <MessageSquare className="h-7 w-7" />
                </div>
                <h2 className="mt-5 text-lg font-semibold text-foreground">Votre espace de discussion</h2>
                <p className="mt-2 text-sm leading-6">Sélectionnez une conversation dans la liste pour retrouver vos échanges ici.</p>
              </div>
            </div>
          )}
        </section>

        {/* Group Details Dialog */}
        {isGroupChat && currentConversation && (
          <Dialog open={groupDetailsOpen} onOpenChange={setGroupDetailsOpen}>
            <DialogContent className="w-full max-w-lg sm:max-w-2xl max-h-[80vh] overflow-auto">
              <DialogHeader>
                <DialogTitle>{currentConversation.groupName}</DialogTitle>
              </DialogHeader>
              <GroupChatView onLeaveGroup={handleLeaveGroupSuccess} />
            </DialogContent>
          </Dialog>
        )}
      </div>
    </DashboardLayout>
  );
};

// Contact Search Result Component
interface ContactSearchResultProps {
  contact: { id: string; invitId: string; name: string; email: string };
  isOnline: boolean;
  onSelect: () => void;
}

const ContactSearchResult = ({ contact, isOnline, onSelect }: ContactSearchResultProps) => {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex w-full items-center gap-3 rounded-2xl border border-transparent p-3 text-left transition-colors hover:border-border/70 hover:bg-background/70"
    >
      <span className="dashboard-tone-blue flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold">
        {(contact.name?.charAt(0) || 'U').toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{contact.name}</span>
          {isOnline && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{contact.email || (isOnline ? 'En ligne' : 'Démarrer une discussion')}</span>
      </span>
      <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
    </button>
  );
};

// Conversation Item Component
interface ConversationItemProps {
  conversation: Conversation;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  getConversationName: (conv: Conversation) => string;
  formatTimestamp: (ts: Timestamp | Date | string | null | undefined) => string;
  isOnline?: boolean;
}

const ConversationItem = ({
  conversation,
  isSelected,
  onSelect,
  onDelete,
  getConversationName,
  formatTimestamp,
  isOnline,
}: ConversationItemProps) => {
  const [showDelete, setShowDelete] = useState(false);
  const name = getConversationName(conversation);

  return (
    <div
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
    className={"group flex w-full min-w-0 items-center gap-2 rounded-2xl border p-2 transition-all " + (isSelected ? 'border-primary/25 bg-primary/10 shadow-sm' : 'border-transparent hover:border-border/70 hover:bg-background/65')}
    >
    <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className={"relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold " + (conversation.type === 'group' ? 'dashboard-tone-lavender' : 'dashboard-tone-mint')}>
          {conversation.type === 'group' ? <UsersRound className="h-5 w-5" /> : (name.charAt(0) || 'U').toUpperCase()}
          {conversation.type === 'direct' && (
            <span className={"absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card " + (isOnline ? 'bg-emerald-500' : 'bg-muted-foreground/35')} />
          )}
        </span>
        <span className="min-w-0 flex-1 py-1">
          <span className="flex min-w-0 items-start justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-foreground" title={name}>{name}</span>
            {conversation.lastMessageTime && <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground">{formatTimestamp(conversation.lastMessageTime)}</span>}
          </span>
          <span className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]" title={conversation.lastMessage || 'Commencez la conversation'}>{conversation.lastMessage || 'Commencez la conversation'}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={`Supprimer la conversation avec ${name}`}
        title="Supprimer la conversation"
        className={"flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive " + (showDelete ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100')}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

// Chat Header Component
interface ChatHeaderProps {
  conversation: Conversation;
  getConversationName: (conv: Conversation) => string;
  isGroupChat: boolean;
  isOnline?: boolean;
  onStartDirectCall: () => void;
  onStartGroupCall: () => void;
  onOpenGroupDetails: () => void;
  onBack: () => void;
}

const ChatHeader = ({
  conversation,
  getConversationName,
  isGroupChat,
  isOnline,
  onStartDirectCall,
  onStartGroupCall,
  onOpenGroupDetails,
  onBack,
}: ChatHeaderProps) => {
  const name = getConversationName(conversation);

  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-card/65 px-4 py-3 sm:px-6 sm:py-4">
      <div className="flex min-w-0 items-center gap-3">
        <Button size="icon" variant="ghost" onClick={onBack} className="h-9 w-9 shrink-0 rounded-xl xl:hidden" aria-label="Retour aux conversations">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className={"hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold sm:flex " + (isGroupChat ? 'dashboard-tone-lavender' : 'dashboard-tone-mint')}>
          {isGroupChat ? <UsersRound className="h-5 w-5" /> : (name.charAt(0) || 'U').toUpperCase()}
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground sm:text-lg">{name}</h2>
          {conversation.type === 'direct' && isOnline !== undefined && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={"h-2 w-2 rounded-full " + (isOnline ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
              {isOnline ? 'En ligne' : 'Hors ligne'}
            </p>
          )}
          {conversation.type === 'group' && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{conversation.groupObjective || 'Conversation de groupe'}</p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {isGroupChat ? (
          <>
            <Button size="icon" variant="outline" onClick={onStartGroupCall} title="Appel audio groupe" aria-label="Appel audio groupe" className="h-9 w-9 rounded-xl sm:h-10 sm:w-10">
              <Phone className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" onClick={onStartGroupCall} title="Appel vidéo groupe" aria-label="Appel vidéo groupe" className="h-9 w-9 rounded-xl sm:h-10 sm:w-10">
              <Video className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={onOpenGroupDetails} className="h-9 rounded-xl px-2.5 text-xs sm:h-10 sm:px-3 sm:text-sm">
              <Settings className="mr-1.5 h-4 w-4" />
              <span className="hidden sm:inline">Détails</span>
            </Button>
          </>
        ) : (
          <>
            <Button size="icon" variant="outline" onClick={onStartDirectCall} title="Appel audio" aria-label="Appel audio" className="h-9 w-9 rounded-xl sm:h-10 sm:w-10">
              <Phone className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" onClick={onStartDirectCall} title="Appel vidéo" aria-label="Appel vidéo" className="h-9 w-9 rounded-xl sm:h-10 sm:w-10">
              <Video className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </header>
  );
};

// Messages Area Component
interface MessagesAreaProps {
  messages: Array<{
    id?: string;
    content: string;
    senderId: string;
    senderName?: string;
    createdAt: Timestamp | Date | string | null;
    readBy?: string[];
  }>;
  userId?: string;
  formatTimestamp: (ts: Timestamp | Date | string | null | undefined) => string;
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

const MessagesArea = ({
  messages,
  userId,
  formatTimestamp,
  messagesEndRef,
}: MessagesAreaProps) => {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-end gap-4 px-4 py-6 sm:px-6 sm:py-8">
        {messages.length === 0 ? (
          <div className="my-auto flex flex-col items-center justify-center py-12 text-center">
            <div className="dashboard-tone-peach flex h-14 w-14 items-center justify-center rounded-2xl">
              <MessageSquare className="h-6 w-6" />
            </div>
            <p className="mt-4 text-sm font-semibold text-foreground">La conversation commence ici</p>
            <p className="mt-1 text-xs text-muted-foreground">Envoyez un message pour lancer l’échange.</p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <MessageGroup
              key={msg.id}
              message={msg}
              isCurrentUser={msg.senderId === userId}
              formatTimestamp={formatTimestamp}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
    </ScrollArea>
  );
};

// Message Group Component (groups consecutive messages from same sender)
interface MessageGroupProps {
  message: {
    id?: string;
    content: string;
    senderId: string;
    senderName?: string;
    createdAt: Timestamp | Date | string | null;
    readBy?: string[];
  };
  isCurrentUser: boolean;
  formatTimestamp: (ts: Timestamp | Date | string | null | undefined) => string;
}

const MessageGroup = ({
  message,
  isCurrentUser,
  formatTimestamp,
}: MessageGroupProps) => {
  const showSenderName = !isCurrentUser;

  return (
    <div className={"flex w-full " + (isCurrentUser ? 'justify-end' : 'justify-start')}>
      <div className={"flex min-w-0 max-w-[88%] flex-col sm:max-w-[75%] " + (isCurrentUser ? 'items-end' : 'items-start')}>
        {showSenderName && <p className="mb-1.5 px-3 text-xs font-semibold text-muted-foreground">{message.senderName || 'Participant'}</p>}
        <div className={"max-w-full min-w-0 rounded-2xl px-4 py-3 text-sm shadow-sm sm:px-5 " + (isCurrentUser ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md border border-border/60 bg-card text-foreground')}>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere] leading-6">{message.content}</p>
          <p className="mt-2 flex items-center justify-end gap-1.5 text-[10px] opacity-70">
            {formatTimestamp(message.createdAt)}
            {isCurrentUser && (message.readBy?.length > 1 ? <CheckCheck className="h-3 w-3" aria-label="Lus" /> : <Clock className="h-3 w-3" aria-label="Envoyé" />)}
          </p>
        </div>
      </div>
    </div>
  );
};

// Message Input Component
interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (e: React.FormEvent) => void;
  isDisabled: boolean;
  isLoading: boolean;
}

const MessageInput = ({
  value,
  onChange,
  onSend,
  isDisabled,
  isLoading,
}: MessageInputProps) => {
  return (
    <div className="shrink-0 border-t border-border/70 bg-card/50 p-3 sm:px-6 sm:py-4">
      <form onSubmit={onSend} className="mx-auto flex w-full max-w-4xl items-center gap-2 rounded-2xl border border-border/70 bg-background/80 p-1.5 shadow-sm sm:gap-3 sm:p-2">
        <Input
          placeholder="Écrire un message…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={isDisabled}
          className="h-10 border-0 bg-transparent px-3 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:h-11 sm:px-4"
        />
        <Button
          type="submit"
          disabled={isDisabled || !value.trim()}
          className="h-10 shrink-0 rounded-xl px-3 sm:h-11 sm:px-4"
          aria-label="Envoyer le message"
        >
          <Send className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">{isLoading ? 'Envoi…' : 'Envoyer'}</span>
        </Button>
      </form>
    </div>
  );
};

export default Messages;
