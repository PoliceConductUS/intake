-- Intake public-schema tables for integration tests (real Postgres via testcontainers).
-- Generated from the intake tables of the dev database, adjusted to load on a plain
-- PostGIS 15 container: audit trigger dropped, PostGIS types moved from Supabase's
-- `extensions` schema to `public`, PG17+ `transaction_timeout` removed.
-- Regenerate: pg_dump the intake tables + this massage (see test/fixtures/database).

--
-- PostgreSQL database dump
--


-- Dumped from database version 15.8
-- Dumped by pg_dump version 18.6 (Homebrew)

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
-- Name: agency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agency (
    id text DEFAULT public.generate_cuid() NOT NULL,
    name text NOT NULL,
    city text NOT NULL,
    state text NOT NULL,
    address text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    zip_code text NOT NULL,
    contact_name text,
    contact_email text,
    slug text NOT NULL,
    location_path_id text NOT NULL,
    latitude double precision,
    longitude double precision,
    CONSTRAINT agency_address_not_blank CHECK (((address IS NULL) OR (char_length(btrim(address)) > 0))),
    CONSTRAINT agency_city_not_blank CHECK (((city IS NULL) OR (char_length(btrim(city)) > 0))),
    CONSTRAINT agency_contact_email_not_blank CHECK (((contact_email IS NULL) OR (char_length(btrim(contact_email)) > 0))),
    CONSTRAINT agency_contact_name_not_blank CHECK (((contact_name IS NULL) OR (char_length(btrim(contact_name)) > 0))),
    CONSTRAINT agency_id_not_blank CHECK ((char_length(btrim(id)) > 0)),
    CONSTRAINT agency_location_path_id_not_blank CHECK ((char_length(btrim(location_path_id)) > 0)),
    CONSTRAINT agency_name_not_blank CHECK ((char_length(btrim(name)) > 0)),
    CONSTRAINT agency_slug_not_blank CHECK ((char_length(btrim(slug)) > 0)),
    CONSTRAINT agency_state_not_blank CHECK ((char_length(btrim(state)) > 0)),
    CONSTRAINT agency_zip_code_not_blank CHECK (((zip_code IS NULL) OR (char_length(btrim(zip_code)) > 0)))
);


--
-- Name: COLUMN agency.contact_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.agency.contact_name IS 'Name of the primary contact person for the agency';


--
-- Name: COLUMN agency.contact_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.agency.contact_email IS 'Email address of the primary contact person for the agency';


--
-- Name: agency_personnel; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agency_personnel (
    id text DEFAULT public.generate_cuid() NOT NULL,
    agency_id text NOT NULL,
    personnel_id text NOT NULL,
    badge_number text,
    start_date date NOT NULL,
    end_date date,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    title text NOT NULL,
    license_id text,
    CONSTRAINT agency_personnel_agency_id_not_blank CHECK ((char_length(btrim(agency_id)) > 0)),
    CONSTRAINT agency_personnel_badge_number_not_blank CHECK (((badge_number IS NULL) OR (char_length(btrim(badge_number)) > 0))),
    CONSTRAINT agency_personnel_id_not_blank CHECK ((char_length(btrim(id)) > 0)),
    CONSTRAINT agency_personnel_license_id_not_blank CHECK (((license_id IS NULL) OR (char_length(btrim(license_id)) > 0))),
    CONSTRAINT agency_personnel_personnel_id_not_blank CHECK ((char_length(btrim(personnel_id)) > 0)),
    CONSTRAINT agency_personnel_title_not_blank CHECK ((char_length(btrim(title)) > 0))
);


--
-- Name: coverage_link_agency_personnel; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coverage_link_agency_personnel (
    id text NOT NULL,
    coverage_link_id text NOT NULL,
    agency_personnel_id text NOT NULL,
    confidence text DEFAULT 'documented'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: coverage_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coverage_links (
    id text NOT NULL,
    url text NOT NULL,
    normalized_url text NOT NULL,
    title text NOT NULL,
    source_name text,
    published_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: discipline; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discipline (
    id text NOT NULL,
    action text NOT NULL,
    effective_date date,
    expiration_date date,
    case_number text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT discipline_action_check CHECK ((char_length(btrim(action)) > 0)),
    CONSTRAINT discipline_case_number_check CHECK (((case_number IS NULL) OR (char_length(btrim(case_number)) > 0)))
);


--
-- Name: discipline_agency_personnel; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discipline_agency_personnel (
    id text NOT NULL,
    discipline_id text NOT NULL,
    agency_personnel_id text NOT NULL
);


--
-- Name: license; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.license (
    id text NOT NULL,
    personnel_id text NOT NULL,
    license_type text NOT NULL,
    status text,
    first_awarded date,
    issued_by_authority_id text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT license_id_not_blank CHECK ((char_length(btrim(id)) > 0)),
    CONSTRAINT license_issued_by_authority_id_not_blank CHECK ((char_length(btrim(issued_by_authority_id)) > 0)),
    CONSTRAINT license_license_type_not_blank CHECK ((char_length(btrim(license_type)) > 0)),
    CONSTRAINT license_personnel_id_not_blank CHECK ((char_length(btrim(personnel_id)) > 0)),
    CONSTRAINT license_status_not_blank CHECK (((status IS NULL) OR (char_length(btrim(status)) > 0)))
);


--
-- Name: license_action; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.license_action (
    id text NOT NULL,
    license_id text NOT NULL,
    action text NOT NULL,
    action_date date,
    status text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT license_action_action_not_blank CHECK ((char_length(btrim(action)) > 0)),
    CONSTRAINT license_action_id_not_blank CHECK ((char_length(btrim(id)) > 0)),
    CONSTRAINT license_action_license_id_not_blank CHECK ((char_length(btrim(license_id)) > 0)),
    CONSTRAINT license_action_status_not_blank CHECK (((status IS NULL) OR (char_length(btrim(status)) > 0)))
);


--
-- Name: licensing_authority; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.licensing_authority (
    id text NOT NULL,
    name text NOT NULL,
    abbreviation text,
    website text,
    location_path_id text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT licensing_authority_abbreviation_not_blank CHECK (((abbreviation IS NULL) OR (char_length(btrim(abbreviation)) > 0))),
    CONSTRAINT licensing_authority_id_not_blank CHECK ((char_length(btrim(id)) > 0)),
    CONSTRAINT licensing_authority_location_path_id_not_blank CHECK ((char_length(btrim(location_path_id)) > 0)),
    CONSTRAINT licensing_authority_name_not_blank CHECK ((char_length(btrim(name)) > 0)),
    CONSTRAINT licensing_authority_website_not_blank CHECK (((website IS NULL) OR (char_length(btrim(website)) > 0)))
);


--
-- Name: location_path; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_path (
    location_path_id text NOT NULL,
    path text NOT NULL,
    level text NOT NULL,
    state_or_territory_slug text NOT NULL,
    administrative_area_slug text,
    place_slug text,
    display_name text NOT NULL,
    parent_location_path_id text,
    centroid public.geography(Point,4326),
    bbox public.geometry(Polygon,4326),
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT location_path_administrative_area_slug_not_blank CHECK (((administrative_area_slug IS NULL) OR (char_length(btrim(administrative_area_slug)) > 0))),
    CONSTRAINT location_path_level_check CHECK ((level = ANY (ARRAY['state'::text, 'administrative_area'::text, 'place'::text]))),
    CONSTRAINT location_path_location_path_id_not_blank CHECK ((char_length(btrim(location_path_id)) > 0)),
    CONSTRAINT location_path_parent_location_path_id_not_blank CHECK (((parent_location_path_id IS NULL) OR (char_length(btrim(parent_location_path_id)) > 0))),
    CONSTRAINT location_path_path_not_blank CHECK ((char_length(btrim(path)) > 0)),
    CONSTRAINT location_path_place_slug_not_blank CHECK (((place_slug IS NULL) OR (char_length(btrim(place_slug)) > 0))),
    CONSTRAINT location_path_state_or_territory_slug_not_blank CHECK ((char_length(btrim(state_or_territory_slug)) > 0))
);


--
-- Name: location_path_alias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_path_alias (
    alias_path text NOT NULL,
    location_path_id text NOT NULL,
    CONSTRAINT location_path_alias_alias_path_not_blank CHECK ((char_length(btrim(alias_path)) > 0)),
    CONSTRAINT location_path_alias_location_path_id_not_blank CHECK ((char_length(btrim(location_path_id)) > 0))
);


--
-- Name: location_path_closure; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_path_closure (
    ancestor_location_path_id text NOT NULL,
    descendant_location_path_id text NOT NULL,
    depth integer NOT NULL,
    CONSTRAINT location_path_closure_depth_check CHECK ((depth >= 0))
);


--
-- Name: location_path_geometry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_path_geometry (
    location_path_id text NOT NULL,
    boundary public.geometry(Geometry,4326) NOT NULL,
    CONSTRAINT location_path_geometry_location_path_id_not_blank CHECK ((char_length(btrim(location_path_id)) > 0))
);


--
-- Name: personnel; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personnel (
    id text DEFAULT public.generate_cuid() NOT NULL,
    first_name text NOT NULL,
    last_name text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    middle_name text,
    prefix text,
    suffix text,
    slug text NOT NULL,
    deceased_on date,
    deceased_source text,
    deceased_message text,
    CONSTRAINT personnel_deceased_message_not_blank CHECK (((deceased_message IS NULL) OR (char_length(btrim(deceased_message)) > 0))),
    CONSTRAINT personnel_deceased_on_not_future_check CHECK (((deceased_on IS NULL) OR (deceased_on <= CURRENT_DATE))),
    CONSTRAINT personnel_deceased_source_not_blank CHECK (((deceased_source IS NULL) OR (char_length(btrim(deceased_source)) > 0))),
    CONSTRAINT personnel_first_name_not_blank CHECK ((char_length(btrim(first_name)) > 0)),
    CONSTRAINT personnel_id_not_blank CHECK ((char_length(btrim(id)) > 0)),
    CONSTRAINT personnel_last_name_not_blank CHECK (((last_name IS NULL) OR (char_length(btrim(last_name)) > 0))),
    CONSTRAINT personnel_middle_name_not_blank CHECK (((middle_name IS NULL) OR (char_length(btrim(middle_name)) > 0))),
    CONSTRAINT personnel_prefix_not_blank CHECK (((prefix IS NULL) OR (char_length(btrim(prefix)) > 0))),
    CONSTRAINT personnel_slug_not_blank CHECK ((char_length(btrim(slug)) > 0)),
    CONSTRAINT personnel_suffix_not_blank CHECK (((suffix IS NULL) OR (char_length(btrim(suffix)) > 0)))
);


--
-- Name: agency_personnel agency_personnel_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_personnel
    ADD CONSTRAINT agency_personnel_pkey PRIMARY KEY (id);


--
-- Name: agency agency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency
    ADD CONSTRAINT agency_pkey PRIMARY KEY (id);


--
-- Name: coverage_link_agency_personnel coverage_link_agency_personnel_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_link_agency_personnel
    ADD CONSTRAINT coverage_link_agency_personnel_pkey PRIMARY KEY (id);


--
-- Name: coverage_links coverage_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_links
    ADD CONSTRAINT coverage_links_pkey PRIMARY KEY (id);


--
-- Name: discipline_agency_personnel discipline_agency_personnel_discipline_id_agency_personnel_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discipline_agency_personnel
    ADD CONSTRAINT discipline_agency_personnel_discipline_id_agency_personnel_id_key UNIQUE (discipline_id, agency_personnel_id);


--
-- Name: discipline_agency_personnel discipline_agency_personnel_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discipline_agency_personnel
    ADD CONSTRAINT discipline_agency_personnel_pkey PRIMARY KEY (id);


--
-- Name: discipline discipline_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discipline
    ADD CONSTRAINT discipline_pkey PRIMARY KEY (id);


--
-- Name: license_action license_action_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.license_action
    ADD CONSTRAINT license_action_pkey PRIMARY KEY (id);


--
-- Name: license license_personnel_id_license_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.license
    ADD CONSTRAINT license_personnel_id_license_type_key UNIQUE (personnel_id, license_type);


--
-- Name: license license_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.license
    ADD CONSTRAINT license_pkey PRIMARY KEY (id);


--
-- Name: licensing_authority licensing_authority_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.licensing_authority
    ADD CONSTRAINT licensing_authority_pkey PRIMARY KEY (id);


--
-- Name: location_path_alias location_path_alias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_path_alias
    ADD CONSTRAINT location_path_alias_pkey PRIMARY KEY (alias_path);


--
-- Name: location_path_closure location_path_closure_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_path_closure
    ADD CONSTRAINT location_path_closure_pkey PRIMARY KEY (ancestor_location_path_id, descendant_location_path_id);


--
-- Name: location_path_geometry location_path_geometry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_path_geometry
    ADD CONSTRAINT location_path_geometry_pkey PRIMARY KEY (location_path_id);


--
-- Name: location_path location_path_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_path
    ADD CONSTRAINT location_path_path_key UNIQUE (path);


--
-- Name: location_path location_path_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_path
    ADD CONSTRAINT location_path_pkey PRIMARY KEY (location_path_id);


--
-- Name: personnel personnel_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personnel
    ADD CONSTRAINT personnel_pkey PRIMARY KEY (id);


--
-- Name: agency_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agency_slug_key ON public.agency USING btree (slug);


--
-- Name: coverage_link_agency_personnel_agency_personnel_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX coverage_link_agency_personnel_agency_personnel_id_idx ON public.coverage_link_agency_personnel USING btree (agency_personnel_id);


--
-- Name: coverage_link_agency_personnel_coverage_link_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX coverage_link_agency_personnel_coverage_link_id_idx ON public.coverage_link_agency_personnel USING btree (coverage_link_id);


--
-- Name: coverage_link_agency_personnel_unique_relationship; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX coverage_link_agency_personnel_unique_relationship ON public.coverage_link_agency_personnel USING btree (coverage_link_id, agency_personnel_id);


--
-- Name: coverage_links_normalized_url_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX coverage_links_normalized_url_key ON public.coverage_links USING btree (normalized_url);


--
-- Name: discipline_agency_personnel_agency_personnel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discipline_agency_personnel_agency_personnel_idx ON public.discipline_agency_personnel USING btree (agency_personnel_id);


--
-- Name: discipline_agency_personnel_discipline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discipline_agency_personnel_discipline_idx ON public.discipline_agency_personnel USING btree (discipline_id);


--
-- Name: license_action_license_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX license_action_license_idx ON public.license_action USING btree (license_id, action_date);


--
-- Name: license_authority_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX license_authority_idx ON public.license USING btree (issued_by_authority_id);


--
-- Name: license_personnel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX license_personnel_idx ON public.license USING btree (personnel_id);


--
-- Name: licensing_authority_location_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX licensing_authority_location_idx ON public.licensing_authority USING btree (location_path_id);


--
-- Name: location_path_closure_descendant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX location_path_closure_descendant_idx ON public.location_path_closure USING btree (descendant_location_path_id);


--
-- Name: location_path_geometry_boundary_gist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX location_path_geometry_boundary_gist ON public.location_path_geometry USING gist (boundary);


--
-- Name: location_path_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX location_path_parent_idx ON public.location_path USING btree (parent_location_path_id);


--
-- Name: personnel_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX personnel_slug_key ON public.personnel USING btree (slug);


--
--




--
-- Name: agency agency_location_path_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency
    ADD CONSTRAINT agency_location_path_id_fkey FOREIGN KEY (location_path_id) REFERENCES public.location_path(location_path_id) ON DELETE RESTRICT;


--
-- Name: agency_personnel agency_personnel_agency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_personnel
    ADD CONSTRAINT agency_personnel_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.agency(id);


--
-- Name: agency_personnel agency_personnel_license_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_personnel
    ADD CONSTRAINT agency_personnel_license_id_fkey FOREIGN KEY (license_id) REFERENCES public.license(id) ON DELETE SET NULL;


--
-- Name: agency_personnel agency_personnel_personnel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_personnel
    ADD CONSTRAINT agency_personnel_personnel_id_fkey FOREIGN KEY (personnel_id) REFERENCES public.personnel(id) ON DELETE CASCADE;


--
-- Name: coverage_link_agency_personnel coverage_link_agency_personnel_agency_personnel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_link_agency_personnel
    ADD CONSTRAINT coverage_link_agency_personnel_agency_personnel_id_fkey FOREIGN KEY (agency_personnel_id) REFERENCES public.agency_personnel(id) ON DELETE CASCADE;


--
-- Name: coverage_link_agency_personnel coverage_link_agency_personnel_coverage_link_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_link_agency_personnel
    ADD CONSTRAINT coverage_link_agency_personnel_coverage_link_id_fkey FOREIGN KEY (coverage_link_id) REFERENCES public.coverage_links(id) ON DELETE CASCADE;


--
-- Name: discipline_agency_personnel discipline_agency_personnel_agency_personnel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discipline_agency_personnel
    ADD CONSTRAINT discipline_agency_personnel_agency_personnel_id_fkey FOREIGN KEY (agency_personnel_id) REFERENCES public.agency_personnel(id) ON DELETE CASCADE;


--
-- Name: discipline_agency_personnel discipline_agency_personnel_discipline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discipline_agency_personnel
    ADD CONSTRAINT discipline_agency_personnel_discipline_id_fkey FOREIGN KEY (discipline_id) REFERENCES public.discipline(id) ON DELETE CASCADE;


--
-- Name: license_action license_action_license_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.license_action
    ADD CONSTRAINT license_action_license_id_fkey FOREIGN KEY (license_id) REFERENCES public.license(id) ON DELETE CASCADE;


--
-- Name: license license_issued_by_authority_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.license
    ADD CONSTRAINT license_issued_by_authority_id_fkey FOREIGN KEY (issued_by_authority_id) REFERENCES public.licensing_authority(id) ON DELETE RESTRICT;


--
-- Name: license license_personnel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.license
    ADD CONSTRAINT license_personnel_id_fkey FOREIGN KEY (personnel_id) REFERENCES public.personnel(id) ON DELETE CASCADE;


--
-- Name: licensing_authority licensing_authority_location_path_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.licensing_authority
    ADD CONSTRAINT licensing_authority_location_path_id_fkey FOREIGN KEY (location_path_id) REFERENCES public.location_path(location_path_id) ON DELETE RESTRICT;


--
-- Name: location_path_alias location_path_alias_location_path_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_path_alias
    ADD CONSTRAINT location_path_alias_location_path_id_fkey FOREIGN KEY (location_path_id) REFERENCES public.location_path(location_path_id) ON DELETE CASCADE;


--
-- Name: location_path_closure location_path_closure_ancestor_location_path_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_path_closure
    ADD CONSTRAINT location_path_closure_ancestor_location_path_id_fkey FOREIGN KEY (ancestor_location_path_id) REFERENCES public.location_path(location_path_id) ON DELETE CASCADE;


--
-- Name: location_path_closure location_path_closure_descendant_location_path_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_path_closure
    ADD CONSTRAINT location_path_closure_descendant_location_path_id_fkey FOREIGN KEY (descendant_location_path_id) REFERENCES public.location_path(location_path_id) ON DELETE CASCADE;


--
-- Name: location_path_geometry location_path_geometry_location_path_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_path_geometry
    ADD CONSTRAINT location_path_geometry_location_path_id_fkey FOREIGN KEY (location_path_id) REFERENCES public.location_path(location_path_id) ON DELETE CASCADE;


--
-- Name: location_path location_path_parent_location_path_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_path
    ADD CONSTRAINT location_path_parent_location_path_id_fkey FOREIGN KEY (parent_location_path_id) REFERENCES public.location_path(location_path_id);


--
-- PostgreSQL database dump complete
--


