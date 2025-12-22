#include <stdio.h>
#include <unistd.h>
#include <termios.h>
#include <fcntl.h>
#include <stdlib.h>
#include <time.h>
#include <string.h>
#include <stdbool.h>

#include "libs/jansson/jansson.h"
#include "libs/mpapi.h"

static void on_mpapi_event(
    const char *event,
    int64_t messageId,
    const char *clientId,
    json_t *data,
    void *context)
{
	
	char* strData = NULL;
	
	if(data)
		strData = json_dumps(data, JSON_INDENT(2));

	printf("mpapi event: %s (msgId: %lld, clientId: %s)\n", event, (long long)messageId, clientId ? clientId : "null");
	if (strData)
	{
		printf("Data: %s\n", strData);
	}

    /* event: "joined", "leaved" (om servern skickar det), eller "game" */
    if (strcmp(event, "joined") == 0) {

	} else if (strcmp(event, "leaved") == 0) {

    } else if (strcmp(event, "game") == 0) {
        
    }

	free(strData);

    /* data är ett json_t* (object); anropa json_incref(data) om du vill spara det efter callbacken */
}

int main_host(mpapi* api)
{
	json_t *data = json_object();
	json_object_set_new(data, "name", json_string("My session"));
	json_object_set_new(data, "private", json_boolean(false));

	json_t* hostPayload = json_object();  /* t.ex. spelinställningar */
	json_object_set_new(hostPayload, "whois", json_string("Robin"));
	json_object_set_new(hostPayload, "map", json_string("forest"));
	json_object_set_new(data, "payload", hostPayload);

	char *session = NULL;
	char *clientId = NULL;
	json_t *hostData = NULL;

	int rc = mpapi_host(api, data, &session, &clientId, &hostData);
	if (rc != MPAPI_OK) {
		printf("Kunde inte skapa session: %d\n", rc);
		return -1;
	}

	json_decref(data);

	printf("Du hostar session: %s (clientId: %s)\n", session, clientId);

	/* hostData kan innehålla extra data från servern (oftast tomt objekt) */
	if (hostData) json_decref(hostData);
	free(session);
	free(clientId);

	return 0;
}

int main_join(mpapi* api, const char* sessionId)
{
	char *joinedSession = NULL;
	char *joinedClientId = NULL;
	json_t *joinPayload = json_object();          /* t.ex. namn, färg osv. */
	json_object_set_new(joinPayload, "name", json_string("Spelare 1"));

	json_t *joinData = NULL;
	int rc = mpapi_join(api, sessionId, joinPayload, &joinedSession, &joinedClientId, &joinData);

	json_decref(joinPayload);  /* vår lokala payload */

	if (rc == MPAPI_OK) {
		printf("Ansluten till session: %s (clientId: %s)\n", joinedSession, joinedClientId);
		/* joinData kan innehålla status eller annan info */

		char* str = json_dumps(joinData, JSON_INDENT(2));
		printf("Join data: %s\n", str);
		free(str);

		if (joinData) json_decref(joinData);
		free(joinedSession);
		free(joinedClientId);
	} else if (rc == MPAPI_ERR_REJECTED) {
		/* t.ex. ogiltigt sessions‑ID, läs ev. joinData för mer info om du valde att ta emot det */
	} else {
		/* nätverksfel/protokollfel etc. */
	}

	return 0;
}

int main_list(mpapi* api)
{
	printf("Hämtar lista över publika sessioner...\n");

	json_t *sessionList = NULL;
	int rc = mpapi_list(api, &sessionList);
	if (rc != MPAPI_OK) {
		printf("Kunde inte hämta session-lista: %d\n", rc);
		return -1;
	}

	const char* firstSessionId = NULL;

	if (json_array_size(sessionList) == 0) {
		printf("Inga publika sessioner tillgängliga.\n");

	} else{
		printf("Totalt %zu sessioner.\n", json_array_size(sessionList));

		size_t index;
		json_t *value;
		printf("Tillgängliga publika sessioner:\n");
		json_array_foreach(sessionList, index, value) {
			json_t *sess_val = json_object_get(value, "id");
			if (json_is_string(sess_val)) {
				if(firstSessionId == NULL)
					firstSessionId = json_string_value(sess_val);

				const char *sessionId = json_string_value(sess_val);
				printf(" - %s\n", sessionId);
			}
		}

		printf("\n");
	}

	if(firstSessionId)
		main_join(api, firstSessionId);
	else
		main_host(api);


	json_decref(sessionList);
	return 0;
}

int main()
{

	mpapi* api = mpapi_create("localhost", 9001, "c2438167-831b-4bf7-8bdc-0489eaf98e25");
	if (!api)
	{
		printf("Failed to create mpapi instance\n");
		return -1;
	}

	mpapi_debug(api, true);

	//main_host(api);
	main_list(api);
	//main_join(api, "HU2J7D");


	mpapi_session sessionInfo;
	mpapi_getSessionInfo(api, &sessionInfo);

	printf("Session info:\n");
	printf(" Session ID: %s\n", sessionInfo.id ? sessionInfo.id : "null");
	printf(" Client ID: %s\n", sessionInfo.clientId);
	printf(" Host ID: %s\n", sessionInfo.hostId);
	printf(" Name: %s\n", sessionInfo.name);
	printf(" Max Clients: %d\n", sessionInfo.maxClients);
	printf(" Host Migration: %s\n", sessionInfo.hostMigration ? "true" : "false");
	printf(" Is Host: %s\n", sessionInfo.isHost ? "true" : "false");
	printf(" Is Private: %s\n", sessionInfo.isPrivate ? "true" : "false");
	printf(" Clients: %s\n", sessionInfo.clients ? json_dumps(sessionInfo.clients, JSON_INDENT(2)) : "null");
	printf(" Payload: %s\n", sessionInfo.payload ? json_dumps(sessionInfo.payload, JSON_INDENT(2)) : "null");
	printf("\n");

	int listener_id = mpapi_listen(api, on_mpapi_event, NULL);
	
	json_t* data = json_object();
	json_object_set_new(data, "score", json_integer(100));

	while (1)
	{
		//int rc = mpapi_game(api, data, NULL);
		//printf("Skickade game-data, rc=%d\n", rc);

		sleep(1);
	}

	json_decref(data);

	mpapi_unlisten(api, listener_id);
	mpapi_destroy(api);

	return 0;
}

