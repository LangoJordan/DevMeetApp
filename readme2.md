# Firebase Firestore — migration des règles pour les appels WebRTC

## Situation actuelle et risque

La règle permissive historiquement signalée dans le projet, à vérifier dans Firebase Console, était :

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Si elle est encore publiée, cette règle autorise tout utilisateur connecté à lire et écrire dans toutes les collections et sous-collections, y compris les invitations, les profils et la signalisation. Elle n’authentifie pas l’identité d’un membre d’une salle au-delà de « connecté ».

Le précédent exemple de ce fichier ajoutait des règles spécifiques, puis conservait la même règle globale. Dans Firestore, les autorisations accordées par plusieurs `match` applicables sont combinées par OU : une règle plus restrictive ne peut pas annuler un `allow` global. Il ne faut donc pas publier cet ancien exemple en le considérant comme une sécurisation.

## Chemins employés par le code

Pour une réunion `reunions/{reunionDocumentId}`, le code utilise :

```text
reunions/{reunionDocumentId}/roomMembers/{uid}
reunions/{reunionDocumentId}/participants/{uid}
reunions/{reunionDocumentId}/connections/{pairId}
reunions/{reunionDocumentId}/connections/{pairId}/offerCandidates/{candidateId}
reunions/{reunionDocumentId}/connections/{pairId}/answerCandidates/{candidateId}
```

Important : `reunionDocumentId` n’est pas nécessairement `roomId`. L’application retrouve aujourd’hui le document de réunion avec une requête `where('roomId', '==', roomId)`. Les invitations sont des documents séparés dans `invitations/{invitationId}` et contiennent `reunionId`, `contactId`, `status` et maintenant `roomId`. Les anciennes invitations peuvent encore contenir l’ancien champ `zegoRoomId`.

## Changements à effectuer dans Firebase Console

1. **Ne publiez pas directement ces règles en production.** Elles bloquent intentionnellement certains parcours historiques; consultez la cartographie ci-dessous et adaptez/testez les pages avant le déploiement.
2. Dans Firebase Console, ouvrez **Firestore Database → Règles** et copiez les règles actuellement publiées dans un fichier local de sauvegarde. Vérifiez aussi que vous modifiez le projet Firebase correspondant aux variables `VITE_FIREBASE_PROJECT_ID` de l’application.
3. Dans une branche/environnement de test, collez le jeu complet ci-dessous dans le simulateur ou l'émulateur. Vérifiez le propriétaire (`creatorId`), le destinataire (`contactId`), l'auteur (`callerId`) ou les participants de conversation pour chaque opération. N'ajoutez pas de joker global permissif.
4. Testez la suite complète dans le simulateur des règles Firestore ou l’émulateur Firebase : inscription, profil, contacts, invitation reçue/acceptée/refusée, historique, conversations/messages, appels de groupe, appel WebRTC, quitter et terminer. Les règles Firestore doivent aussi tenir compte des requêtes : une requête ne peut lire que les documents qui satisfont ses contraintes.
5. Pour les règles de salle ci-dessous, vérifiez qu’un utilisateur est membre via `roomMembers/{uid}` et qu’une invitation correspond à `request.auth.uid`, au `reunionId` parent et au statut `accepted`. Les règles ne peuvent pas valider la logique exécutée uniquement côté client.
6. Migrez les données historiques avant de retirer l’accès global : ajoutez `invitedUserIds` aux réunions depuis les invitations dont le `contactId` est valide, ajoutez `memberIds` aux groupes depuis `members[].userId`, et créez `publicProfiles/{uid}` avec uniquement nom, photo et présence. Complétez aussi `roomId`, `hostId`, `maxParticipants` et `expiresAt` lorsque nécessaires, puis vérifiez les réunions annulées/terminées. Conservez les anciens champs `zegoRoomId` jusqu'à expiration ou conversion de tous les liens.
7. Après les tests et la migration, publiez le jeu complet de règles sans joker global, puis vérifiez les erreurs de permission dans les journaux Firebase et dans le navigateur.

## Jeu de règles restrictif à valider dans l'émulateur

Le bloc ci-dessous couvre les salles, les collections historiques auditées et un refus par défaut des chemins inconnus. Il est volontairement restrictif et exige la migration des anciens documents indiquée plus bas. Il n'est pas certifié prêt pour la production sans simulation des cas décrits plus bas.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function isCreator(reunionId) {
      return signedIn()
        && get(/databases/$(database)/documents/reunions/$(reunionId)).data.creatorId == request.auth.uid;
    }

    function isRoomMember(reunionId) {
      return signedIn()
        && exists(/databases/$(database)/documents/reunions/$(reunionId)/roomMembers/$(request.auth.uid));
    }

    function isPublicRoom(reunionId) {
      return get(/databases/$(database)/documents/reunions/$(reunionId)).data.type == 'public';
    }

    function roomIsOpen(reunionId) {
      let room = get(/databases/$(database)/documents/reunions/$(reunionId)).data;
      return room.status != 'completed'
        && room.status != 'closed'
        && (!('expiresAt' in room) || request.time < room.expiresAt);
    }

    match /reunions/{reunionId} {
      allow get: if signedIn() && (resource.data.type == 'public'
        || resource.data.creatorId == request.auth.uid
        || ('invitedUserIds' in resource.data && request.auth.uid in resource.data.invitedUserIds)
        || isRoomMember(reunionId));
      allow list: if signedIn() && (resource.data.type == 'public'
        || resource.data.creatorId == request.auth.uid
        || ('invitedUserIds' in resource.data && request.auth.uid in resource.data.invitedUserIds)
        || isRoomMember(reunionId));
      allow create: if signedIn()
        && request.resource.data.creatorId == request.auth.uid
        && request.resource.data.hostId == request.auth.uid
        && request.resource.data.invitedUserIds is list
        && request.auth.uid in request.resource.data.invitedUserIds
        && request.resource.data.maxParticipants <= 6;
      allow update: if signedIn() && isCreator(reunionId);
      allow delete: if false;

      match /roomMembers/{uid} {
        allow get: if signedIn() && (request.auth.uid == uid || isCreator(reunionId));
        allow list: if isCreator(reunionId);
        allow create, update: if signedIn()
          && request.auth.uid == uid
          && roomIsOpen(reunionId)
          && request.resource.data.uid == uid
          && ((isCreator(reunionId) && request.resource.data.role == 'host')
            || (isPublicRoom(reunionId) && request.resource.data.role in ['participant', 'viewer'])
            || (request.resource.data.invitationId is string
              && exists(/databases/$(database)/documents/invitations/$(request.resource.data.invitationId))
              && get(/databases/$(database)/documents/invitations/$(request.resource.data.invitationId)).data.reunionId == reunionId
              && get(/databases/$(database)/documents/invitations/$(request.resource.data.invitationId)).data.contactId == request.auth.uid
              && get(/databases/$(database)/documents/invitations/$(request.resource.data.invitationId)).data.status == 'accepted'
              && request.resource.data.role == get(/databases/$(database)/documents/invitations/$(request.resource.data.invitationId)).data.role));
        allow delete: if signedIn() && (request.auth.uid == uid || isCreator(reunionId));
      }

      match /participants/{uid} {
        allow read: if isRoomMember(reunionId);
        allow create, update: if signedIn()
          && request.auth.uid == uid
          && isRoomMember(reunionId)
          && roomIsOpen(reunionId)
          && request.resource.data.uid == uid;
        allow delete: if signedIn() && request.auth.uid == uid;
      }

      match /connections/{pairId} {
        allow read: if isRoomMember(reunionId);
        allow create: if isRoomMember(reunionId)
          && roomIsOpen(reunionId)
          && (request.resource.data.offererId == request.auth.uid
            || request.resource.data.answererId == request.auth.uid);
        allow update: if isRoomMember(reunionId)
          && roomIsOpen(reunionId)
          && (resource.data.offererId == request.auth.uid
            || resource.data.answererId == request.auth.uid)
          && request.resource.data.offererId == resource.data.offererId
          && request.resource.data.answererId == resource.data.answererId;
        allow delete: if isRoomMember(reunionId)
          && (resource.data.offererId == request.auth.uid
            || resource.data.answererId == request.auth.uid);

        match /{candidateCollection}/{candidateId} {
          allow read: if isRoomMember(reunionId)
            && candidateCollection in ['offerCandidates', 'answerCandidates'];
          allow create: if isRoomMember(reunionId)
            && roomIsOpen(reunionId)
            && candidateCollection in ['offerCandidates', 'answerCandidates']
            && request.resource.data.from == request.auth.uid;
          allow delete: if isRoomMember(reunionId)
            && candidateCollection in ['offerCandidates', 'answerCandidates'];
          allow update: if false;
        }
      }
    }

    function isConversationMember(conversationId) {
      return signedIn()
        && exists(/databases/$(database)/documents/conversations/$(conversationId))
        && request.auth.uid in get(/databases/$(database)/documents/conversations/$(conversationId)).data.participantIds;
    }

    function isInvitationParty() {
      return signedIn()
        && (resource.data.contactId == request.auth.uid
          || resource.data.callerId == request.auth.uid
          || get(/databases/$(database)/documents/reunions/$(resource.data.reunionId)).data.creatorId == request.auth.uid);
    }

    match /profiles/{uid} {
      allow get: if signedIn() && request.auth.uid == uid;
      allow list: if false;
      allow create: if signedIn()
        && request.auth.uid == uid
        && request.resource.data.userId == uid;
      allow update: if signedIn()
        && request.auth.uid == uid
        && request.resource.data.userId == resource.data.userId;
      allow delete: if signedIn() && request.auth.uid == uid;
    }

    match /publicProfiles/{uid} {
      allow get: if signedIn();
      allow list: if false;
      allow create, update: if signedIn()
        && request.auth.uid == uid
        && request.resource.data.keys().hasOnly(['displayName', 'photoURL', 'isOnline', 'updatedAt']);
      allow delete: if signedIn() && request.auth.uid == uid;
    }

    match /contacts/{contactId} {
      allow get, list: if signedIn() && resource.data.creatorId == request.auth.uid;
      allow create: if signedIn() && request.resource.data.creatorId == request.auth.uid;
      allow update: if signedIn()
        && resource.data.creatorId == request.auth.uid
        && request.resource.data.creatorId == resource.data.creatorId;
      allow delete: if signedIn() && resource.data.creatorId == request.auth.uid;
    }

    match /invitations/{invitationId} {
      allow get: if isInvitationParty();
      allow list: if signedIn()
        && (resource.data.contactId == request.auth.uid || resource.data.callerId == request.auth.uid);
      allow create: if signedIn()
        && request.resource.data.callerId == request.auth.uid
        && request.resource.data.reunionId is string
        && get(/databases/$(database)/documents/reunions/$(request.resource.data.reunionId)).data.creatorId == request.auth.uid;
      allow update: if signedIn()
        && request.resource.data.reunionId == resource.data.reunionId
        && request.resource.data.callerId == resource.data.callerId
        && request.resource.data.contactId == resource.data.contactId
        && request.resource.data.role == resource.data.role
        && ((resource.data.contactId == request.auth.uid
            && request.resource.data.diff(resource.data).affectedKeys()
              .hasOnly(['status', 'viewed', 'debut', 'dateFin', 'updatedAt'])
            && request.resource.data.status in ['accepted', 'declined', 'missed'])
          || (resource.data.callerId == request.auth.uid
            && request.resource.data.diff(resource.data).affectedKeys()
              .hasOnly(['status', 'viewed', 'debut', 'dateFin', 'updatedAt', 'url', 'roomId'])
            && (request.resource.data.status == resource.data.status
              || request.resource.data.status in ['pending', 'missed', 'cancelled'])));
      allow delete: if signedIn()
        && (resource.data.callerId == request.auth.uid
          || get(/databases/$(database)/documents/reunions/$(resource.data.reunionId)).data.creatorId == request.auth.uid);
    }

    match /conversations/{conversationId} {
      allow get, list: if signedIn() && request.auth.uid in resource.data.participantIds;
      allow create: if signedIn()
        && request.resource.data.participantIds is list
        && request.auth.uid in request.resource.data.participantIds
        && request.resource.data.participantIds.size() >= 2;
      allow update: if isConversationMember(conversationId)
        && ((request.resource.data.participantIds == resource.data.participantIds
            && request.resource.data.diff(resource.data).affectedKeys()
              .hasOnly(['lastMessage', 'lastMessageTime', 'updatedAt', 'deletedFor'])
            && (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['deletedFor'])
              || (request.resource.data.deletedFor is list
                && request.auth.uid in request.resource.data.deletedFor
                && (!('deletedFor' in resource.data)
                  || request.resource.data.deletedFor.hasAll(resource.data.deletedFor)))))
          || (resource.data.type == 'group'
            && resource.data.creatorId == request.auth.uid
            && request.resource.data.creatorId == resource.data.creatorId
            && request.resource.data.participantIds is list
            && request.auth.uid in request.resource.data.participantIds
            && request.resource.data.diff(resource.data).affectedKeys()
              .hasOnly(['participantIds', 'updatedAt', 'groupName', 'groupObjective', 'groupDescription'])));
      allow delete: if false;

      match /messages/{messageId} {
        allow get, list: if isConversationMember(conversationId);
        allow create: if isConversationMember(conversationId)
          && request.resource.data.senderId == request.auth.uid;
        allow update: if isConversationMember(conversationId)
          && request.resource.data.senderId == resource.data.senderId
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['readBy'])
          && request.resource.data.readBy is list
          && request.auth.uid in request.resource.data.readBy
          && request.resource.data.readBy.hasAll(resource.data.readBy);
        allow delete: if isConversationMember(conversationId)
          && resource.data.senderId == request.auth.uid;
      }
    }

    match /notifications/{notificationId} {
      function invitation() {
        return get(/databases/$(database)/documents/invitations/$(request.resource.data.invitationId)).data;
      }
      allow get, list: if signedIn() && resource.data.recipientId == request.auth.uid;
      allow create: if signedIn()
        && request.resource.data.keys().hasOnly(['type', 'recipientId', 'callerId', 'reunionId', 'invitationId', 'userName', 'callerName', 'createdAt', 'read'])
        && request.resource.data.read == false
        && exists(/databases/$(database)/documents/invitations/$(request.resource.data.invitationId))
        && invitation().reunionId == request.resource.data.reunionId
        && ((request.resource.data.type == 'invitation_received'
            && invitation().callerId == request.auth.uid
            && invitation().contactId == request.resource.data.recipientId)
          || (request.resource.data.type == 'invitation_accepted'
            && invitation().contactId == request.auth.uid
            && invitation().callerId == request.resource.data.recipientId
            && invitation().status == 'accepted')
          || (request.resource.data.type == 'invitation_declined'
            && invitation().contactId == request.auth.uid
            && invitation().callerId == request.resource.data.recipientId
            && invitation().status == 'declined'));
      allow update: if signedIn()
        && resource.data.recipientId == request.auth.uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['read'])
        && request.resource.data.read == true;
      allow delete: if false;
    }

    function isGroupMember(groupId) {
      return signedIn()
        && exists(/databases/$(database)/documents/groups/$(groupId))
        && 'memberIds' in get(/databases/$(database)/documents/groups/$(groupId)).data
        && request.auth.uid in get(/databases/$(database)/documents/groups/$(groupId)).data.memberIds;
    }

    match /groups/{groupId} {
      allow get, list: if signedIn()
        && 'memberIds' in resource.data
        && request.auth.uid in resource.data.memberIds;
      allow create: if signedIn()
        && request.resource.data.creatorId == request.auth.uid
        && request.resource.data.memberIds is list
        && request.auth.uid in request.resource.data.memberIds;
      allow update: if signedIn()
        && resource.data.creatorId == request.auth.uid
        && request.resource.data.creatorId == resource.data.creatorId
        && request.resource.data.memberIds is list
        && request.auth.uid in request.resource.data.memberIds;
      allow delete: if false;
    }

    match /groupCalls/{callId} {
      allow get, list: if signedIn()
        && (resource.data.creatorId == request.auth.uid
          || request.auth.uid in resource.data.selectedParticipants);
      allow create: if signedIn()
        && request.resource.data.creatorId == request.auth.uid
        && isGroupMember(request.resource.data.groupId)
        && request.resource.data.selectedParticipants is list
        && get(/databases/$(database)/documents/groups/$(request.resource.data.groupId)).data.memberIds.hasAll(request.resource.data.selectedParticipants);
      allow update, delete: if false;
    }

    match /callNotifications/{notificationId} {
      allow get, list: if signedIn()
        && (resource.data.recipientId == request.auth.uid || resource.data.callerId == request.auth.uid);
      allow create: if signedIn()
        && request.resource.data.callerId == request.auth.uid
        && isGroupMember(request.resource.data.groupId)
        && exists(/databases/$(database)/documents/groupCalls/$(request.resource.data.callId))
        && get(/databases/$(database)/documents/groupCalls/$(request.resource.data.callId)).data.creatorId == request.auth.uid
        && request.resource.data.recipientId in get(/databases/$(database)/documents/groupCalls/$(request.resource.data.callId)).data.selectedParticipants;
      allow update: if signedIn()
        && resource.data.recipientId == request.auth.uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['viewed', 'status']);
      allow delete: if false;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

## Collections historiques et pages concernées

Les règles ci-dessus remplacent le placeholder par des règles explicites, sans joker permissif. Les parcours de notification, de groupe et d'appel ont des contrôles dédiés; les anciennes données doivent toutefois être migrées et le jeu de règles republié pour que ces changements prennent effet.

| Collection / chemin | Règle appliquée | Pages, composants et services concernés | Adaptation nécessaire |
|---|---|---|---|
| `profiles/{uid}` et `publicProfiles/{uid}` | Profil privé lisible par son propriétaire; fiche publique limitée au nom, photo et présence | `Register`, `Settings`, `AuthContext`, `authService`, `Contacts`, `Messages`, `GroupsContext`, `IncomingCallContext`, `OutgoingCallContext`, `Invitations`, `CallHistory`, `CallDetails`, `useContactPresence` | Les anciennes fiches publiques sont créées lors de la prochaine connexion/activité de l'utilisateur. `ContactForm` continue de rechercher par email dans le profil privé; cette découverte doit passer par un backend autorisé plutôt que d'ouvrir la liste des profils. |
| `contacts/{id}` | Propriétaire `creatorId`; la liste doit filtrer `creatorId == uid` | `Contacts`, `Dashboard`, `InvitationForm`, `Messages`, `CreateGroupDialog`, `contactService` | Les requêtes principales ont déjà le filtre propriétaire. Tester les anciennes données qui n'ont pas `creatorId`. |
| `reunions/{id}` et sous-collections WebRTC | Créateur, invité enregistré dans `invitedUserIds`, ou membre; création de `roomMembers` pour l'invité après acceptation | `Contacts`, `InvitationForm`, `Invitations`, `Meeting`, `Dashboard`, `CallHistory`, `CallDetails`, `callService`, `useWebRTCRoom`, `IncomingCallContext`, `OutgoingCallContext` | Les nouveaux appels inscrivent les UID invités avant de les appeler; le destinataire crée son propre `roomMembers/{uid}` après acceptation. Les anciennes réunions doivent recevoir `invitedUserIds` à partir des invitations valides. |
| `invitations/{id}` | Lecture par invité/émetteur; création par le propriétaire de la réunion; mise à jour limitée aux parties | `Contacts`, `InvitationForm`, `Invitations`, `Meeting`, `Dashboard`, `CallHistory`, `CallDetails`, `callService`, contextes d'appels | Les écrans de listes utilisent maintenant `contactId == uid` pour les invitations reçues ou `callerId == uid` pour celles émises; les vues ne peuvent afficher les invitations des autres participants sans backend. Les règles empêchent un invité de modifier `role`/`callerId`. |
| `conversations/{id}` et `messages/{id}` | Membres listés dans `participantIds`; envoi par l'auteur; suppression de message par son auteur | `Messages`, `MessagesContext`, `GroupsContext` | La requête de conversations filtre déjà `participantIds`. `deleteConversation` supprime aujourd'hui tous les messages, y compris ceux des autres auteurs : cette opération échouera. Remplacer la suppression physique par un masquage par utilisateur (`deletedFor`) ou un backend de modération. Les créations de conversations doivent inclure l'UID du créateur dans `participantIds`. |
| `notifications/{id}` | Lecture et mise à jour par `recipientId`; création vérifiée contre le document d'invitation et son statut | `Header`, `useNotifications`, `notificationService`, `Contacts`, contextes d'appels | Les anciennes notifications utilisent des destinataires incohérents; elles ne seront pas visibles via les nouvelles requêtes tant qu'elles ne seront pas normalisées ou expirées. |
| `groups/{id}` | Lecture par `memberIds`; écritures réservées au créateur | `GroupsContext`, `CreateGroupDialog`, `GroupCallForm`, `Messages` | Les groupes existants doivent être migrés pour ajouter `memberIds`; le client filtre désormais la requête par UID. |
| `groupCalls/{id}`, `callNotifications/{id}` | Création par membre du groupe; lecture par créateur/participant ou destinataire | `GroupCallForm` et parcours d'appels de groupe | Les appels de groupe doivent garder `selectedParticipants` et `recipientId` à jour; tester le parcours complet avant de le déployer. |

### Limites à vérifier avant publication

- Ce bloc est un **socle restrictif de règles**. Les lectures de profils privés par d'autres utilisateurs et la découverte de contacts par email restent volontairement bloquées. Les anciennes réunions, groupes et notifications nécessitent une migration de données; les nouvelles réunions doivent contenir `invitedUserIds` et les nouveaux groupes `memberIds`.
- Les règles Firestore évaluent chaque document retourné et ne filtrent pas le résultat d'une requête. Les requêtes des pages doivent contenir les mêmes contraintes d'appartenance que les règles.
- Le champ `members` de `groups` reste un tableau d'objets pour l'affichage; les autorisations et les requêtes utilisent `memberIds`, qui doit être migré et maintenu avec `members`.
- Vérifier au simulateur/émulateur les scénarios inscription, paramètres, contacts, invitations acceptées/refusées, historique, messages, suppression/masquage, appels WebRTC et appels de groupe. Ce document ne certifie pas ces tests.
- La règle `connections` autorise encore les membres de la réunion, pas exclusivement les deux UIDs encodés dans `pairId`. Renforcer ce contrôle avec un schéma normalisé de paire et le tester avant de traiter les signaux comme isolés entre deux participants.
- `maxParticipants <= 6` valide uniquement la valeur écrite, pas le nombre simultané de participants. Le comptage client est sujet aux courses; une limite fiable exige une transaction ou un service serveur.
- `roomIsOpen` accepte les anciens documents sans `expiresAt`. Après migration, rendre ce champ obligatoire si toutes les réunions doivent expirer.
- Les règles Firestore ne coupent pas elles-mêmes les flux média; les clients le font lorsqu'ils observent le changement de statut. Les navigateurs qui ferment brutalement peuvent laisser des documents de présence périmés, à traiter par une politique d'expiration/cleanup.


## Authentification et coûts

Le code de salle requiert actuellement un utilisateur Firebase authentifié. Activer le fournisseur **Authentication → Sign-in method → Anonymous** ne suffit pas : il faut aussi ajouter explicitement `signInAnonymously(auth)` au parcours d’entrée, prévoir une stratégie de rôle/autorisation et tester les règles avec ces comptes. Cette connexion automatique n’est pas encore implémentée.

Firestore stocke uniquement la signalisation et la présence; l’audio/vidéo transite par WebRTC entre navigateurs, ou par TURN si un relais est configuré. Les lectures/écritures ICE peuvent consommer le quota Firebase. Mesurez les appels réels et mettez en place une durée de conservation/cleanup avant de promettre un nombre fixe d’appels gratuits. Vérifiez aussi **Authentication → Settings → Authorized domains** pour chaque domaine de déploiement; les médias requièrent HTTPS, sauf localhost.
