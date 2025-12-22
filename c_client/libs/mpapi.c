#include "mpapi.h"

#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <errno.h>

#include <unistd.h>
#include <pthread.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <netdb.h>
#include <arpa/inet.h>

typedef struct ListenerNode {
    int id;
    mpapiListener cb;
    void *context;
    struct ListenerNode *next;
} ListenerNode;

typedef struct ListenerSnapshot {
    mpapiListener cb;
    void *context;
} ListenerSnapshot;

struct mpapi {
    char *server_host;
    uint16_t server_port;

	char identifier[37];

	mpapi_session session;

    int sockfd;

    pthread_t recv_thread;
    int recv_thread_started;
    int running;

    pthread_mutex_t lock;
    ListenerNode *listeners;
    int next_listener_id;

	bool debug;
};

static int connect_to_server(const char *host, uint16_t port);
static int ensure_connected(mpapi *api);
static int send_all(int fd, const char *buf, size_t len);
static int send_json_line(mpapi *api, json_t *obj); /* tar över ägarskap */
static int read_line(mpapi *api, char **out_line);
static void *recv_thread_main(void *arg);
static void process_line(mpapi *api, const char *line);
static int start_recv_thread(mpapi *api);

mpapi *mpapi_create(const char *server_host, uint16_t server_port, const char *identifier)
{
    int len = strlen(identifier);
	if (len != 36) {
		return NULL;
	}
	
	mpapi *api = (mpapi *)calloc(1, sizeof(mpapi));
    if (!api) {
        return NULL;
    }


    if (server_host) {
        api->server_host = strdup(server_host);
    } else {
        api->server_host = strdup("127.0.0.1");
    }

    if (!api->server_host) {
        free(api);
        return NULL;
    }

    api->server_port = server_port;
	
	strncpy(api->identifier, identifier, 37);

    api->sockfd = -1;
    api->recv_thread_started = 0;
    api->running = 0;
    api->listeners = NULL;
    api->next_listener_id = 1;

	memset(&api->session, 0, sizeof(mpapi_session));

	api->debug = false;

    if (pthread_mutex_init(&api->lock, NULL) != 0) {
        free(api->server_host);
        free(api);
        return NULL;
    }

    return api;
}

void mpapi_debug(mpapi *api, bool enable)
{
	if (!api) return;
	api->debug = enable;
}

void mpapi_getSessionInfo(mpapi* api, mpapi_session* out_session)
{
	if (!api || !out_session) return;

	memcpy(out_session, &api->session, sizeof(mpapi_session));

	out_session->clients = json_copy(api->session.clients);
	out_session->payload = json_copy(api->session.payload);
}

void mpapi_destroy(mpapi *api) {
    if (!api) return;

    if (api->recv_thread_started && api->sockfd >= 0) {
        shutdown(api->sockfd, SHUT_RDWR);
        pthread_join(api->recv_thread, NULL);
    }

    if (api->sockfd >= 0) {
        close(api->sockfd);
    }

    pthread_mutex_lock(&api->lock);
    ListenerNode *node = api->listeners;
    api->listeners = NULL;
    pthread_mutex_unlock(&api->lock);

    while (node) {
        ListenerNode *next = node->next;
        free(node);
        node = next;
    }

	if(api->session.payload)
	{
		json_decref(api->session.payload);
		api->session.payload = NULL;
	}

	if(api->session.clients)
	{
		json_decref(api->session.clients);
		api->session.clients = NULL;
	}

    if (api->session.id) {
        free(api->session.id);
		api->session.id = NULL;
    }

    if (api->server_host) {
        free(api->server_host);
    }

    pthread_mutex_destroy(&api->lock);
    free(api);
}

int mpapi_parse_session_info(mpapi* api, json_t* data)
{
	json_t* sessionId_val = json_object_get(data, "session");
    if (!json_is_string(sessionId_val))
        return MPAPI_ERR_PROTOCOL;
    
    const char* sessionId = json_is_string(sessionId_val) ? json_string_value(sessionId_val) : NULL;
	if(!sessionId) 
		return MPAPI_ERR_PROTOCOL;
	
    api->session.id = strdup(sessionId);
    if (!api->session.id)
        return MPAPI_ERR_IO;
    
    json_t* clientId_val = json_object_get(data, "clientId");
    const char *clientId = json_is_string(clientId_val) ? json_string_value(clientId_val) : NULL;
	if(!clientId)
		return MPAPI_ERR_PROTOCOL;
	
	if(strlen(clientId) != 36)
		return MPAPI_ERR_PROTOCOL;
	

	strcpy(api->session.clientId, clientId);
	strcpy(api->session.hostId, clientId);

	json_t* name_val = json_object_get(data, "name");
    const char* name = json_is_string(name_val) ? json_string_value(name_val) : NULL;
	if(name) {
		strncpy(api->session.name, name, sizeof(api->session.name) - 1);
		api->session.name[64] = '\0'; //Ensure null-termination
	} else {
		memset(api->session.name, 0, sizeof(api->session.name));
	}

	json_t* maxClients_val = json_object_get(data, "maxClients");
	if (json_is_integer(maxClients_val)) {
		api->session.maxClients = (int)json_integer_value(maxClients_val);
	} else {
		api->session.maxClients = 0;
	}

	json_t* hostMigration_val = json_object_get(data, "hostMigration");
	if (json_is_boolean(hostMigration_val)) {
		api->session.hostMigration = json_is_true(hostMigration_val);
	} else {
		api->session.hostMigration = false;
	}

	json_t* private_val = json_object_get(data, "isPrivate");
	if (json_is_boolean(private_val)) {
		api->session.isPrivate = json_is_true(private_val);
	} else {
		api->session.isPrivate = false;
	}

	json_t* clients_val = json_object_get(data, "clients");
	if (json_is_array(clients_val)) {
		api->session.clients = json_copy(clients_val);
	} else {
		api->session.clients = json_array();
	}

	json_t* payload_val = json_object_get(data, "payload");
	if (json_is_object(payload_val)) {
		api->session.payload = json_copy(payload_val);
	} else {
		api->session.payload = json_object();
	}
	
	api->session.isHost = true;

	return MPAPI_OK;
}

int mpapi_host(mpapi *api,
				json_t *data,
                char **out_session,
                char **out_clientId,
                json_t **out_data) {
    if (!api) return MPAPI_ERR_ARGUMENT;
    if (api->session.id) return MPAPI_ERR_STATE;

    int rc = ensure_connected(api);
    if (rc != MPAPI_OK) return rc;

    json_t *root = json_object();
    if (!root) return MPAPI_ERR_IO;

    json_object_set_new(root, "identifier", json_string(api->identifier));
    json_object_set_new(root, "cmd", json_string("host"));
    
	json_t *data_copy;
    if (data && json_is_object(data)) {
        data_copy = json_deep_copy(data);
    } else {
        data_copy = json_object();
    }
    json_object_set_new(root, "data", data_copy);

    rc = send_json_line(api, root);
    if (rc != MPAPI_OK) {
        return rc;
    }

    char *line = NULL;
    rc = read_line(api, &line);
    if (rc != MPAPI_OK) {
        return rc;
    }

    json_error_t jerr;
    json_t *resp = json_loads(line, 0, &jerr);
    free(line);
    if (!resp || !json_is_object(resp)) {
        if (resp) json_decref(resp);
        return MPAPI_ERR_PROTOCOL;
    }

    json_t *cmd_val = json_object_get(resp, "cmd");
    if (!json_is_string(cmd_val) || strcmp(json_string_value(cmd_val), "host") != 0) {
        json_decref(resp);
        return MPAPI_ERR_PROTOCOL;
    }

    rc = mpapi_parse_session_info(api, resp);
	if (rc != MPAPI_OK) {
		json_decref(resp);
		return rc;
	}

    if (out_session)
        *out_session = strdup(api->session.id);
    
    if (out_clientId)
        *(out_clientId) = strdup(api->session.clientId);
    
    if (out_data)
        *(out_data) = json_copy(api->session.payload);	

    json_decref(resp);

    rc = start_recv_thread(api);
    if (rc != MPAPI_OK) {
        return rc;
    }

    return MPAPI_OK;
}

int mpapi_list(mpapi *api, json_t **out_list)
{
	if (!api || !out_list) return MPAPI_ERR_ARGUMENT;

	int rc = ensure_connected(api);
	if (rc != MPAPI_OK) return rc;

	json_t *root = json_object();
	if (!root) return MPAPI_ERR_IO;

    json_object_set_new(root, "identifier", json_string(api->identifier));
	json_object_set_new(root, "cmd", json_string("list"));

	rc = send_json_line(api, root);
	if (rc != MPAPI_OK) {
		return rc;
	}

	char *line = NULL;
	rc = read_line(api, &line);
	if (rc != MPAPI_OK) {
		return rc;
	}

	json_error_t jerr;
	json_t *resp = json_loads(line, 0, &jerr);
	free(line);
	if (!resp || !json_is_object(resp)) {
		if (resp) json_decref(resp);
		return MPAPI_ERR_PROTOCOL;
	}

	json_t *cmd_val = json_object_get(resp, "cmd");
	if (!json_is_string(cmd_val) || strcmp(json_string_value(cmd_val), "list") != 0) {
		json_decref(resp);
		return MPAPI_ERR_PROTOCOL;
	}

	json_t *list_val = json_object_get(resp, "data");
	if (!json_is_object(list_val)) {
		json_decref(resp);
		return MPAPI_ERR_PROTOCOL;
	}

	json_t *list_obj = json_object_get(list_val, "list");
	if (!json_is_array(list_obj)) {
		json_decref(resp);
		return MPAPI_ERR_PROTOCOL;
	}

	*out_list = list_obj;
	json_incref(*out_list);

	json_decref(resp);
	return MPAPI_OK;
}

int mpapi_join(mpapi *api,
                const char *sessionId,
                json_t *data,
                char **out_session,
                char **out_clientId,
                json_t **out_data) {
    if (!api || !sessionId) return MPAPI_ERR_ARGUMENT;
    if (api->session.id) return MPAPI_ERR_STATE;

    int rc = ensure_connected(api);
    if (rc != MPAPI_OK) return rc;

    json_t *root = json_object();
    if (!root) return MPAPI_ERR_IO;
	
    json_object_set_new(root, "identifier", json_string(api->identifier));
    json_object_set_new(root, "session", json_string(sessionId));
    json_object_set_new(root, "cmd", json_string("join"));

    json_t *data_copy;
    if (data && json_is_object(data)) {
        data_copy = json_deep_copy(data);
    } else {
        data_copy = json_object();
    }
    json_object_set_new(root, "data", data_copy);

    rc = send_json_line(api, root);
    if (rc != MPAPI_OK) {
        return rc;
    }

    char *line = NULL;
    rc = read_line(api, &line);
    if (rc != MPAPI_OK) {
        return rc;
    }

    json_error_t jerr;
    json_t *resp = json_loads(line, 0, &jerr);
    free(line);
    if (!resp || !json_is_object(resp)) {
        if (resp) json_decref(resp);
        return MPAPI_ERR_PROTOCOL;
    }

    json_t *cmd_val = json_object_get(resp, "cmd");
    if (!json_is_string(cmd_val) || strcmp(json_string_value(cmd_val), "join") != 0) {
        json_decref(resp);
        return MPAPI_ERR_PROTOCOL;
    }

    rc = mpapi_parse_session_info(api, resp);
	if (rc != MPAPI_OK) {
		json_decref(resp);
		return rc;
	}

    json_t* error_val = json_object_get(resp, "error");
	if (error_val) {
		printf("Join rejected: %s\n", json_string_value(error_val));
		json_decref(resp);
		return MPAPI_ERR_REJECTED;
	}

    if (out_session) 
        *(out_session) = strdup(api->session.id);
    
    if (out_clientId) 
        *(out_clientId) = strdup(api->session.clientId);   
    
    if (out_data)
        *(out_data) = json_copy(api->session.payload);

    json_decref(resp);

    rc = start_recv_thread(api);
	if (rc != MPAPI_OK) {
		return rc;
	}

	api->session.isHost = false;

    return MPAPI_OK;
}

int mpapi_game(mpapi *api, json_t *data, const char* destination) {
    if (!api || !data) return MPAPI_ERR_ARGUMENT;
    if (api->sockfd < 0 || !api->session.id) return MPAPI_ERR_STATE;

    json_t *root = json_object();
    if (!root) return MPAPI_ERR_IO;

	json_object_set_new(root, "identifier", json_string(api->identifier));
    json_object_set_new(root, "session", json_string(api->session.id));
    json_object_set_new(root, "cmd", json_string("game"));

	if(destination)
		json_object_set_new(root, "destination", json_string(destination));

    json_t *data_copy;
    if (json_is_object(data)) {
        data_copy = json_deep_copy(data);
    } else {
        data_copy = json_object();
    }
    json_object_set_new(root, "data", data_copy);

    return send_json_line(api, root);
}

int mpapi_listen(mpapi *api,
                  mpapiListener cb,
                  void *context) {
    if (!api || !cb) return -1;

    ListenerNode *node = (ListenerNode *)malloc(sizeof(ListenerNode));
    if (!node) return -1;

    node->cb = cb;
    node->context = context;

    pthread_mutex_lock(&api->lock);
    node->id = api->next_listener_id++;
    node->next = api->listeners;
    api->listeners = node;
    pthread_mutex_unlock(&api->lock);

    return node->id;
}

void mpapi_unlisten(mpapi *api, int listener_id) {
    if (!api || listener_id <= 0) return;

    pthread_mutex_lock(&api->lock);
    ListenerNode *prev = NULL;
    ListenerNode *cur = api->listeners;
    while (cur) {
        if (cur->id == listener_id) {
            if (prev) {
                prev->next = cur->next;
            } else {
                api->listeners = cur->next;
            }
            free(cur);
            break;
        }
        prev = cur;
        cur = cur->next;
    }
    pthread_mutex_unlock(&api->lock);
}

/* --- Interna hjälpfunktioner --- */

static int connect_to_server(const char *host, uint16_t port) {
    if (!host) host = "127.0.0.1";

    char port_str[16];
    snprintf(port_str, sizeof(port_str), "%u", (unsigned int)port);

    struct addrinfo hints;
    memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_UNSPEC;      /* IPv4 eller IPv6 */
    hints.ai_socktype = SOCK_STREAM;

    struct addrinfo *res = NULL;
    int err = getaddrinfo(host, port_str, &hints, &res);
    if (err != 0) {
        return -1;
    }

    int fd = -1;
    for (struct addrinfo *rp = res; rp != NULL; rp = rp->ai_next) {
        fd = socket(rp->ai_family, rp->ai_socktype, rp->ai_protocol);
        if (fd == -1) continue;
        if (connect(fd, rp->ai_addr, rp->ai_addrlen) == 0) {
            break;
        }
        close(fd);
        fd = -1;
    }

    freeaddrinfo(res);
    return fd;
}

static int ensure_connected(mpapi *api) {
    if (!api) return MPAPI_ERR_ARGUMENT;
    if (api->sockfd >= 0) return MPAPI_OK;

    int fd = connect_to_server(api->server_host, api->server_port);
    if (fd < 0) {
        return MPAPI_ERR_CONNECT;
    }
    api->sockfd = fd;
    return MPAPI_OK;
}

static int send_all(int fd, const char *buf, size_t len) {
    size_t sent = 0;
    while (sent < len) {
        ssize_t n = send(fd, buf + sent, len - sent, 0);
        if (n < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        if (n == 0) {
            return -1;
        }
        sent += (size_t)n;
    }
    return 0;
}

static int send_json_line(mpapi *api, json_t *obj) {
    if (!api || api->sockfd < 0 || !obj) return MPAPI_ERR_ARGUMENT;

    char *text = json_dumps(obj, JSON_COMPACT);
    if (!text) {
        json_decref(obj);
        return MPAPI_ERR_IO;
    }

	if(api->debug)
		printf("TX: %s\n", text);

    size_t len = strlen(text);
    int fd = api->sockfd;

    int rc = 0;
    if (send_all(fd, text, len) != 0 || send_all(fd, "\n", 1) != 0) {
        rc = MPAPI_ERR_IO;
    }

    free(text);
    json_decref(obj);

    return rc;
}

static int read_line(mpapi *api, char **out_line) {
    if (!out_line) return MPAPI_ERR_ARGUMENT;

    size_t cap = 256;
    size_t len = 0;
    char *buf = (char *)malloc(cap);
    if (!buf) return MPAPI_ERR_IO;

    for (;;) {
        char c;
        ssize_t n = recv(api->sockfd, &c, 1, 0);
        if (n < 0) {
            if (errno == EINTR) continue;
            free(buf);
            return MPAPI_ERR_IO;
        }
        if (n == 0) {
            free(buf);
            return MPAPI_ERR_IO;
        }

        if (c == '\n') {
            break;
        }

        if (len + 1 >= cap) {
            cap *= 2;
            char *tmp = (char *)realloc(buf, cap);
            if (!tmp) {
                free(buf);
                return MPAPI_ERR_IO;
            }
            buf = tmp;
        }

        buf[len++] = c;
    }

    buf[len] = '\0';

	if(api->debug)
		printf("RX: %s\n", buf);

    *out_line = buf;
    return MPAPI_OK;
}

static void process_line(mpapi *api, const char *line) {
    if (!api || !line || !*line) return;

    json_error_t jerr;
    json_t *root = json_loads(line, 0, &jerr);
    if (!root || !json_is_object(root)) {
        if (root) json_decref(root);
        return;
    }

    json_t *cmd_val = json_object_get(root, "cmd");
    if (!json_is_string(cmd_val)) {
        json_decref(root);
        return;
    }

    const char *cmd = json_string_value(cmd_val);
    if (!cmd) {
        json_decref(root);
        return;
    }

    if (strcmp(cmd, "joined") != 0 &&
        strcmp(cmd, "leaved") != 0 &&
        strcmp(cmd, "game") != 0) {
        json_decref(root);
        return;
    }

    json_int_t msgId = 0;
    json_t *mid_val = json_object_get(root, "messageId");
    if (json_is_integer(mid_val)) {
        msgId = json_integer_value(mid_val);
    }

    const char *clientId = NULL;
    json_t *cid_val = json_object_get(root, "clientId");
    if (json_is_string(cid_val)) {
        clientId = json_string_value(cid_val);
    }

    json_t *data_val = json_object_get(root, "data");
    json_t *data_obj;
    if (json_is_object(data_val)) {
        data_obj = data_val;
        json_incref(data_obj);
    } else {
        data_obj = json_object();
    }

    pthread_mutex_lock(&api->lock);
    int count = 0;
    ListenerNode *node = api->listeners;
    while (node) {
        if (node->cb) count++;
        node = node->next;
    }

    if (count == 0) {
        pthread_mutex_unlock(&api->lock);
        json_decref(data_obj);
        json_decref(root);
        return;
    }

    ListenerSnapshot *snapshot = (ListenerSnapshot *)malloc(sizeof(ListenerSnapshot) * count);
    if (!snapshot) {
        pthread_mutex_unlock(&api->lock);
        json_decref(data_obj);
        json_decref(root);
        return;
    }

    int idx = 0;
    node = api->listeners;
    while (node) {
        if (node->cb) {
            snapshot[idx].cb = node->cb;
            snapshot[idx].context = node->context;
            idx++;
        }
        node = node->next;
    }
    pthread_mutex_unlock(&api->lock);

    for (int i = 0; i < count; ++i) {
        snapshot[i].cb(cmd, (int64_t)msgId, clientId, data_obj, snapshot[i].context);
    }

    free(snapshot);
    json_decref(data_obj);
    json_decref(root);
}

static void *recv_thread_main(void *arg) {
    mpapi *api = (mpapi *)arg;
    char buffer[1024];
    char *acc = NULL;
    size_t acc_len = 0;
    size_t acc_cap = 0;

    while (1) {
        ssize_t n = recv(api->sockfd, buffer, sizeof(buffer), 0);
        if (n <= 0) {
            break;
        }

        for (ssize_t i = 0; i < n; ++i) {
            char ch = buffer[i];
            if (ch == '\n') {
                if (acc_len > 0) {
                    char *line = (char *)malloc(acc_len + 1);
                    if (!line) {
                        acc_len = 0;
                        continue;
                    }
                    memcpy(line, acc, acc_len);
                    line[acc_len] = '\0';

                    acc_len = 0;
                    process_line(api, line);
                    free(line);
                } else {
                    acc_len = 0;
                }
            } else {
                if (acc_len + 1 >= acc_cap) {
                    size_t new_cap = acc_cap == 0 ? 256 : acc_cap * 2;
                    char *tmp = (char *)realloc(acc, new_cap);
                    if (!tmp) {
                        free(acc);
                        acc = NULL;
                        acc_len = 0;
                        acc_cap = 0;
                        break;
                    }
                    acc = tmp;
                    acc_cap = new_cap;
                }
                acc[acc_len++] = ch;
            }
        }
    }

    if (acc) {
        free(acc);
    }

    return NULL;
}

static int start_recv_thread(mpapi *api) {
    if (!api) return MPAPI_ERR_ARGUMENT;
    if (api->recv_thread_started) {
        return MPAPI_OK;
    }

    api->running = 1;
    int rc = pthread_create(&api->recv_thread, NULL, recv_thread_main, api);
    if (rc != 0) {
        api->running = 0;
        return MPAPI_ERR_IO;
    }

    api->recv_thread_started = 1;
    return MPAPI_OK;
}
