#ifndef MPAPI_API_H
#define MPAPI_API_H

#include <stdint.h>
#include "jansson/jansson.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct mpapi mpapi;

/* Callback‑typ för inkommande events från servern. */
typedef void (*mpapiListener)(
    const char *event,      /* "joined", "leaved", "game" */
    int64_t messageId,      /* sekventiellt meddelande‑ID (från host) */
    const char *clientId,   /* avsändarens klient‑ID (eller NULL) */
    json_t *data,           /* JSON‑objekt med godtycklig speldata */
    void *context         /* godtycklig pekare som skickas vidare */
);

/* Returkoder */
enum {
    MPAPI_OK = 0,
    MPAPI_ERR_ARGUMENT = 1,
    MPAPI_ERR_STATE = 2,
    MPAPI_ERR_CONNECT = 3,
    MPAPI_ERR_PROTOCOL = 4,
    MPAPI_ERR_IO = 5,
    MPAPI_ERR_REJECTED = 6  /* t.ex. ogiltigt sessions‑ID vid join */
};

/* Skapar en ny API‑instans. Returnerar NULL vid fel. */
mpapi *mpapi_create(const char *server_host, uint16_t server_port, const char *identifier);

/* Stänger ner anslutning, stoppar mottagartråd och frigör minne. */
void mpapi_destroy(mpapi *api);

/* Hostar en ny session. Blockerar tills svar erhållits eller fel uppstår.
   out_session / out_clientId pekar på nyallokerade strängar (malloc) som
   anroparen ansvarar för att free:a. out_data (om ej NULL) får ett json_t*
   med extra data från servern (anroparen ska json_decref när klart). */
int mpapi_host(mpapi *api,
				json_t *data,
                char **out_session,
                char **out_clientId,
                json_t **out_data);

/*
   Hämtar en lista över tillgängliga publika sessioner.
   Returnerar MPAPI_OK vid framgång, annan felkod vid fel.
   Anroparen ansvarar för att json_decref:a out_list när klar. */
int mpapi_list(mpapi *api,
                  json_t **out_list);

/* Går med i befintlig session.
   sessionId: sessionskod (t.ex. "ABC123").
   data: valfri JSON‑payload med spelarinformation (kan vara NULL).
   out_* fungerar som i mpapi_host.

   Returnerar:
   - MPAPI_OK        vid lyckad join
   - MPAPI_ERR_REJECTED om servern svarar med status:error (t.ex. ogiltigt ID)
   - annan felkod vid nätverks/protokoll‑fel.
*/
int mpapi_join(mpapi *api,
                const char *sessionId,
                json_t *data,
                char **out_session,
                char **out_clientId,
                json_t **out_data);

/* Skickar ett "game"‑meddelande med godtycklig JSON‑data till sessionen. */
int mpapi_game(mpapi *api, json_t *data, const char* destination);

/* Registrerar en lyssnare för inkommande events.
   Returnerar ett positivt listener‑ID, eller −1 vid fel. */
int mpapi_listen(mpapi *api,
                  mpapiListener cb,
                  void *context);

/* Avregistrerar lyssnare. Listener‑ID är värdet från mpapi_listen. */
void mpapi_unlisten(mpapi *api, int listener_id);

#ifdef __cplusplus
}
#endif

#endif /* MPAPI_API_H */
