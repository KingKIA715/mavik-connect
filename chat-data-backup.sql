--
-- PostgreSQL database dump
--

\restrict lpgR26AaldGPds7zMGJecjSMS7JUvBMi0QcVpHtLzF0vgLCy3iO061aULNVaDlL

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: dm_keys; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.dm_keys (
    thread_id integer NOT NULL,
    user_id text NOT NULL,
    wrapped_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.dm_keys OWNER TO postgres;

--
-- Name: dm_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.dm_messages (
    id integer NOT NULL,
    thread_id integer NOT NULL,
    sender_id text NOT NULL,
    content text NOT NULL,
    type text DEFAULT 'text'::text NOT NULL,
    file_name text,
    mime_type text,
    file_size integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone
);


ALTER TABLE public.dm_messages OWNER TO postgres;

--
-- Name: dm_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.dm_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.dm_messages_id_seq OWNER TO postgres;

--
-- Name: dm_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.dm_messages_id_seq OWNED BY public.dm_messages.id;


--
-- Name: dm_threads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.dm_threads (
    id integer NOT NULL,
    user_a_id text NOT NULL,
    user_b_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_a_last_read_at timestamp with time zone,
    user_b_last_read_at timestamp with time zone
);


ALTER TABLE public.dm_threads OWNER TO postgres;

--
-- Name: dm_threads_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.dm_threads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.dm_threads_id_seq OWNER TO postgres;

--
-- Name: dm_threads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.dm_threads_id_seq OWNED BY public.dm_threads.id;


--
-- Name: group_keys; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.group_keys (
    group_id integer NOT NULL,
    user_id text NOT NULL,
    wrapped_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.group_keys OWNER TO postgres;

--
-- Name: group_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.group_members (
    group_id integer NOT NULL,
    user_id text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    last_read_at timestamp with time zone
);


ALTER TABLE public.group_members OWNER TO postgres;

--
-- Name: groups; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.groups (
    id integer NOT NULL,
    name text NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.groups OWNER TO postgres;

--
-- Name: groups_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.groups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.groups_id_seq OWNER TO postgres;

--
-- Name: groups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.groups_id_seq OWNED BY public.groups.id;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.messages (
    id integer NOT NULL,
    group_id integer NOT NULL,
    sender_id text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    type text DEFAULT 'text'::text NOT NULL,
    file_name text,
    mime_type text,
    file_size integer,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone
);


ALTER TABLE public.messages OWNER TO postgres;

--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.messages_id_seq OWNER TO postgres;

--
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;


--
-- Name: dm_messages id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dm_messages ALTER COLUMN id SET DEFAULT nextval('public.dm_messages_id_seq'::regclass);


--
-- Name: dm_threads id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dm_threads ALTER COLUMN id SET DEFAULT nextval('public.dm_threads_id_seq'::regclass);


--
-- Name: groups id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.groups ALTER COLUMN id SET DEFAULT nextval('public.groups_id_seq'::regclass);


--
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);


--
-- Data for Name: dm_keys; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.dm_keys (thread_id, user_id, wrapped_key, created_at) FROM stdin;
\.


--
-- Data for Name: dm_messages; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.dm_messages (id, thread_id, sender_id, content, type, file_name, mime_type, file_size, created_at, edited_at, deleted_at) FROM stdin;
\.


--
-- Data for Name: dm_threads; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.dm_threads (id, user_a_id, user_b_id, created_at, user_a_last_read_at, user_b_last_read_at) FROM stdin;
\.


--
-- Data for Name: group_keys; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.group_keys (group_id, user_id, wrapped_key, created_at) FROM stdin;
\.


--
-- Data for Name: group_members; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.group_members (group_id, user_id, role, joined_at, last_read_at) FROM stdin;
\.


--
-- Data for Name: groups; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.groups (id, name, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: messages; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.messages (id, group_id, sender_id, content, created_at, type, file_name, mime_type, file_size, edited_at, deleted_at) FROM stdin;
\.


--
-- Name: dm_messages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.dm_messages_id_seq', 1, false);


--
-- Name: dm_threads_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.dm_threads_id_seq', 1, false);


--
-- Name: groups_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.groups_id_seq', 1, false);


--
-- Name: messages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.messages_id_seq', 1, false);


--
-- Name: dm_keys dm_keys_thread_id_user_id_pk; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dm_keys
    ADD CONSTRAINT dm_keys_thread_id_user_id_pk PRIMARY KEY (thread_id, user_id);


--
-- Name: dm_messages dm_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dm_messages
    ADD CONSTRAINT dm_messages_pkey PRIMARY KEY (id);


--
-- Name: dm_threads dm_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dm_threads
    ADD CONSTRAINT dm_threads_pkey PRIMARY KEY (id);


--
-- Name: dm_threads dm_threads_user_a_id_user_b_id_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dm_threads
    ADD CONSTRAINT dm_threads_user_a_id_user_b_id_unique UNIQUE (user_a_id, user_b_id);


--
-- Name: group_keys group_keys_group_id_user_id_pk; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.group_keys
    ADD CONSTRAINT group_keys_group_id_user_id_pk PRIMARY KEY (group_id, user_id);


--
-- Name: group_members group_members_group_id_user_id_pk; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_group_id_user_id_pk PRIMARY KEY (group_id, user_id);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: dm_keys dm_keys_thread_id_dm_threads_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dm_keys
    ADD CONSTRAINT dm_keys_thread_id_dm_threads_id_fk FOREIGN KEY (thread_id) REFERENCES public.dm_threads(id) ON DELETE CASCADE;


--
-- Name: dm_keys dm_keys_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dm_keys
    ADD CONSTRAINT dm_keys_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: dm_messages dm_messages_sender_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dm_messages
    ADD CONSTRAINT dm_messages_sender_id_users_id_fk FOREIGN KEY (sender_id) REFERENCES public.users(id);


--
-- Name: dm_messages dm_messages_thread_id_dm_threads_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dm_messages
    ADD CONSTRAINT dm_messages_thread_id_dm_threads_id_fk FOREIGN KEY (thread_id) REFERENCES public.dm_threads(id) ON DELETE CASCADE;


--
-- Name: dm_threads dm_threads_user_a_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dm_threads
    ADD CONSTRAINT dm_threads_user_a_id_users_id_fk FOREIGN KEY (user_a_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: dm_threads dm_threads_user_b_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dm_threads
    ADD CONSTRAINT dm_threads_user_b_id_users_id_fk FOREIGN KEY (user_b_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: group_keys group_keys_group_id_groups_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.group_keys
    ADD CONSTRAINT group_keys_group_id_groups_id_fk FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;


--
-- Name: group_keys group_keys_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.group_keys
    ADD CONSTRAINT group_keys_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: group_members group_members_group_id_groups_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_group_id_groups_id_fk FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;


--
-- Name: group_members group_members_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: groups groups_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: messages messages_group_id_groups_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_group_id_groups_id_fk FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;


--
-- Name: messages messages_sender_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_users_id_fk FOREIGN KEY (sender_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

\unrestrict lpgR26AaldGPds7zMGJecjSMS7JUvBMi0QcVpHtLzF0vgLCy3iO061aULNVaDlL

