-- Barbearia João Ribeiro: execute este script em um projeto Supabase próprio.
-- O script cria tabelas isoladas por prefixo, politicas RLS e funcoes de agenda.
-- O horario de funcionamento e os servicos devem ser cadastrados pelo painel admin.
--
-- Primeiro acesso:
-- 1. Crie o usuario do João em Supabase > Authentication > Users.
-- 2. Copie o UUID desse usuario e execute o INSERT de membro no final deste arquivo.
-- 3. Entre no painel e configure os horarios de funcionamento e os servicos/precos.

begin;

create extension if not exists pgcrypto;

create table if not exists public.joao_barbeiros (
    id uuid primary key default gen_random_uuid(),
    nome text not null unique check (char_length(btrim(nome)) between 2 and 120),
    telefone text,
    ativo boolean not null default true,
    criado_em timestamptz not null default now()
);

create table if not exists public.joao_servicos (
    id uuid primary key default gen_random_uuid(),
    nome text not null unique check (char_length(btrim(nome)) between 2 and 120),
    preco numeric(10,2) not null check (preco >= 0),
    duracao_minutos integer not null check (duracao_minutos between 15 and 480),
    ativo boolean not null default true,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now()
);

create table if not exists public.joao_membros (
    user_id uuid primary key references auth.users(id) on delete cascade,
    barbeiro_id uuid references public.joao_barbeiros(id) on delete set null,
    is_admin boolean not null default false,
    criado_em timestamptz not null default now(),
    constraint joao_membro_tem_acesso check (is_admin or barbeiro_id is not null)
);

create table if not exists public.joao_horarios (
    id uuid primary key default gen_random_uuid(),
    barbeiro_id uuid not null references public.joao_barbeiros(id) on delete cascade,
    dia_semana smallint not null check (dia_semana between 1 and 7),
    hora_inicio time not null,
    hora_fim time not null,
    intervalo_minutos integer not null default 30 check (intervalo_minutos between 15 and 180),
    ativo boolean not null default true,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    constraint joao_horario_intervalo check (hora_inicio < hora_fim),
    constraint joao_horario_unico_por_dia unique (barbeiro_id, dia_semana)
);

create table if not exists public.joao_agendamentos (
    id uuid primary key default gen_random_uuid(),
    barbeiro_id uuid not null references public.joao_barbeiros(id) on delete restrict,
    cliente text not null check (char_length(btrim(cliente)) between 2 and 120),
    telefone text not null default ''
        check (char_length(btrim(telefone)) = 0 or char_length(btrim(telefone)) between 8 and 24),
    servico_ids uuid[] not null,
    servicos_resumo text not null,
    servicos_snapshot jsonb not null,
    preco_total numeric(10,2) not null check (preco_total >= 0),
    duracao_minutos integer not null check (duracao_minutos between 15 and 960),
    data date not null,
    horario time not null,
    status text not null default 'pendente'
        check (status in ('pendente', 'confirmado', 'concluido', 'cancelado')),
    pagamento text check (pagamento in ('Pix', 'Dinheiro', 'Debito', 'Credito')),
    origem text not null default 'site' check (origem in ('site', 'painel')),
    criado_por uuid references auth.users(id) on delete set null,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now()
);

create table if not exists public.joao_bloqueios (
    id uuid primary key default gen_random_uuid(),
    barbeiro_id uuid not null references public.joao_barbeiros(id) on delete cascade,
    data date not null,
    hora_inicio time,
    hora_fim time,
    dia_todo boolean not null default false,
    motivo text not null default '',
    criado_por uuid not null default auth.uid() references auth.users(id) on delete restrict,
    criado_em timestamptz not null default now(),
    constraint joao_bloqueio_intervalo check (
        (dia_todo and hora_inicio is null and hora_fim is null)
        or
        (not dia_todo and hora_inicio is not null and hora_fim is not null and hora_inicio < hora_fim)
    )
);

create index if not exists joao_agendamentos_barbeiro_data_idx
    on public.joao_agendamentos (barbeiro_id, data, horario);
create index if not exists joao_agendamentos_data_status_idx
    on public.joao_agendamentos (data, status);
create index if not exists joao_bloqueios_barbeiro_data_idx
    on public.joao_bloqueios (barbeiro_id, data);

insert into public.joao_barbeiros (nome, telefone)
values ('João Ribeiro', '+55 31 9185-2472')
on conflict (nome) do nothing;

create or replace function public.joao_e_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.joao_membros m
        where m.user_id = (select auth.uid())
          and m.is_admin
    );
$$;

create or replace function public.joao_barbeiro_atual()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select m.barbeiro_id
    from public.joao_membros m
    where m.user_id = (select auth.uid())
    limit 1;
$$;

create or replace function public.joao_atualizar_timestamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.atualizado_em = now();
    return new;
end;
$$;

drop trigger if exists joao_servicos_atualizado_em on public.joao_servicos;
create trigger joao_servicos_atualizado_em
    before update on public.joao_servicos
    for each row execute function public.joao_atualizar_timestamp();

drop trigger if exists joao_horarios_atualizado_em on public.joao_horarios;
create trigger joao_horarios_atualizado_em
    before update on public.joao_horarios
    for each row execute function public.joao_atualizar_timestamp();

drop trigger if exists joao_agendamentos_atualizado_em on public.joao_agendamentos;
create trigger joao_agendamentos_atualizado_em
    before update on public.joao_agendamentos
    for each row execute function public.joao_atualizar_timestamp();

create or replace function public.joao_horarios_ocupados(
    p_barbeiro_id uuid,
    p_data date
)
returns table (inicio time, duracao_minutos integer, dia_todo boolean)
language sql
stable
security definer
set search_path = ''
as $$
    select a.horario, a.duracao_minutos, false
    from public.joao_agendamentos a
    where a.barbeiro_id = p_barbeiro_id
      and a.data = p_data
      and a.status in ('pendente', 'confirmado')
    union all
    select
        coalesce(b.hora_inicio, time '00:00'),
        case
            when b.dia_todo then 1440
            else greatest(1, extract(epoch from (b.hora_fim - b.hora_inicio))::integer / 60)
        end,
        b.dia_todo
    from public.joao_bloqueios b
    where b.barbeiro_id = p_barbeiro_id
      and b.data = p_data;
$$;

create or replace function public.joao_validar_conflito_agendamento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_horario public.joao_horarios%rowtype;
begin
    if new.status = 'cancelado' then
        return new;
    end if;

    if tg_op = 'UPDATE'
       and new.barbeiro_id = old.barbeiro_id
       and new.data = old.data
       and new.horario = old.horario
       and new.duracao_minutos = old.duracao_minutos
       and old.status <> 'cancelado' then
        return new;
    end if;

    perform pg_advisory_xact_lock(
        hashtextextended(new.barbeiro_id::text || ':' || new.data::text, 0)
    );

    if new.data < timezone('America/Sao_Paulo', now())::date
       or new.data > timezone('America/Sao_Paulo', now())::date + 21 then
        raise exception 'A data deve estar entre hoje e os proximos 21 dias.';
    end if;

    select h.* into v_horario
    from public.joao_horarios h
    where h.barbeiro_id = new.barbeiro_id
      and h.dia_semana = extract(isodow from new.data)::smallint
      and h.ativo;

    if not found
       or new.horario < v_horario.hora_inicio
       or mod(
            extract(epoch from (new.horario - v_horario.hora_inicio))::integer / 60,
            v_horario.intervalo_minutos
       ) <> 0
       or (date '2000-01-01' + new.horario + make_interval(mins => new.duracao_minutos))
          > (date '2000-01-01' + v_horario.hora_fim) then
        raise exception 'O horario escolhido esta fora do expediente configurado.';
    end if;

    if exists (
        select 1
        from public.joao_agendamentos a
        where a.barbeiro_id = new.barbeiro_id
          and a.data = new.data
          and a.id <> new.id
          and a.status in ('pendente', 'confirmado')
          and new.horario < (a.horario + make_interval(mins => a.duracao_minutos))
          and a.horario < (new.horario + make_interval(mins => new.duracao_minutos))
    ) then
        raise exception 'Este horario conflita com outro agendamento.';
    end if;

    if exists (
        select 1
        from public.joao_bloqueios b
        where b.barbeiro_id = new.barbeiro_id
          and b.data = new.data
          and (
              b.dia_todo
              or (
                  new.horario < b.hora_fim
                  and b.hora_inicio < (new.horario + make_interval(mins => new.duracao_minutos))
              )
          )
    ) then
        raise exception 'Este horario esta bloqueado.';
    end if;

    return new;
end;
$$;

drop trigger if exists joao_agendamentos_validar_conflito on public.joao_agendamentos;
create trigger joao_agendamentos_validar_conflito
    before update of barbeiro_id, data, horario, duracao_minutos, status
    on public.joao_agendamentos
    for each row execute function public.joao_validar_conflito_agendamento();

create or replace function public.joao_criar_agendamento(
    p_barbeiro_id uuid,
    p_data date,
    p_horario time,
    p_cliente text,
    p_telefone text,
    p_servico_ids uuid[],
    p_origem text default 'site'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_ids uuid[];
    v_quantidade integer;
    v_preco numeric(10,2);
    v_duracao integer;
    v_servicos jsonb;
    v_resumo text;
    v_horario public.joao_horarios%rowtype;
    v_id uuid;
begin
    if p_origem not in ('site', 'painel') then
        raise exception 'Origem de agendamento invalida.';
    end if;

    if p_origem = 'painel' and (
        (select auth.uid()) is null
        or (
            not (select public.joao_e_admin())
            and (select public.joao_barbeiro_atual()) is distinct from p_barbeiro_id
        )
    ) then
        raise exception 'Sem permissao para criar agendamento pelo painel.';
    end if;

    if char_length(btrim(coalesce(p_cliente, ''))) not between 2 and 120 then
        raise exception 'Informe o nome do cliente.';
    end if;

    if not (
        (p_origem = 'painel' and char_length(regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g')) = 0)
        or char_length(regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g')) between 10 and 15
    ) then
        raise exception 'Informe um telefone valido com DDD.';
    end if;

    if p_data < timezone('America/Sao_Paulo', now())::date
       or p_data > timezone('America/Sao_Paulo', now())::date + 21 then
        raise exception 'A data deve estar entre hoje e os proximos 21 dias.';
    end if;

    if p_horario is null or p_servico_ids is null or cardinality(p_servico_ids) = 0 then
        raise exception 'Selecione um horario e pelo menos um servico.';
    end if;

    if not exists (
        select 1 from public.joao_barbeiros b
        where b.id = p_barbeiro_id and b.ativo
    ) then
        raise exception 'Barbeiro indisponivel.';
    end if;

    select array_agg(distinct s.id order by s.id)
    into v_ids
    from unnest(p_servico_ids) as escolhido(id)
    join public.joao_servicos s on s.id = escolhido.id
    where s.ativo;

    if coalesce(cardinality(v_ids), 0) <> cardinality(p_servico_ids) then
        raise exception 'Um ou mais servicos nao estao disponiveis.';
    end if;

    select
        count(*)::integer,
        coalesce(sum(s.preco), 0)::numeric(10,2),
        coalesce(sum(s.duracao_minutos), 0)::integer,
        jsonb_agg(jsonb_build_object(
            'id', s.id,
            'nome', s.nome,
            'preco', s.preco,
            'duracao_minutos', s.duracao_minutos
        ) order by s.nome),
        string_agg(s.nome, ', ' order by s.nome)
    into v_quantidade, v_preco, v_duracao, v_servicos, v_resumo
    from public.joao_servicos s
    where s.id = any(v_ids) and s.ativo;

    if v_quantidade <> cardinality(v_ids) then
        raise exception 'Nao foi possivel validar os servicos selecionados.';
    end if;

    select h.* into v_horario
    from public.joao_horarios h
    where h.barbeiro_id = p_barbeiro_id
      and h.dia_semana = extract(isodow from p_data)::smallint
      and h.ativo;

    if not found then
        raise exception 'Nao ha expediente cadastrado para este dia.';
    end if;

    if p_horario < v_horario.hora_inicio
       or mod(
            extract(epoch from (p_horario - v_horario.hora_inicio))::integer / 60,
            v_horario.intervalo_minutos
       ) <> 0
       or (date '2000-01-01' + p_horario + make_interval(mins => v_duracao))
          > (date '2000-01-01' + v_horario.hora_fim) then
        raise exception 'O horario selecionado esta fora do expediente.';
    end if;

    perform pg_advisory_xact_lock(
        hashtextextended(p_barbeiro_id::text || ':' || p_data::text, 0)
    );

    if exists (
        select 1
        from public.joao_agendamentos a
        where a.barbeiro_id = p_barbeiro_id
          and a.data = p_data
          and a.status in ('pendente', 'confirmado')
          and p_horario < (a.horario + make_interval(mins => a.duracao_minutos))
          and a.horario < (p_horario + make_interval(mins => v_duracao))
    ) then
        raise exception 'Este horario acabou de ser reservado. Escolha outro.';
    end if;

    if exists (
        select 1
        from public.joao_bloqueios b
        where b.barbeiro_id = p_barbeiro_id
          and b.data = p_data
          and (
              b.dia_todo
              or (
                  p_horario < b.hora_fim
                  and b.hora_inicio < (p_horario + make_interval(mins => v_duracao))
              )
          )
    ) then
        raise exception 'Este horario esta bloqueado. Escolha outro.';
    end if;

    insert into public.joao_agendamentos (
        barbeiro_id, cliente, telefone, servico_ids, servicos_resumo,
        servicos_snapshot, preco_total, duracao_minutos, data, horario,
        status, origem, criado_por
    )
    values (
        p_barbeiro_id, btrim(p_cliente),
        regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g'),
        v_ids, v_resumo, v_servicos, v_preco, v_duracao, p_data, p_horario,
        'pendente', p_origem, (select auth.uid())
    )
    returning id into v_id;

    return v_id;
end;
$$;

alter table public.joao_barbeiros enable row level security;
alter table public.joao_servicos enable row level security;
alter table public.joao_membros enable row level security;
alter table public.joao_horarios enable row level security;
alter table public.joao_agendamentos enable row level security;
alter table public.joao_bloqueios enable row level security;

revoke all on public.joao_barbeiros, public.joao_servicos, public.joao_membros,
    public.joao_horarios, public.joao_agendamentos, public.joao_bloqueios
    from public, anon, authenticated;

grant select on public.joao_barbeiros, public.joao_servicos, public.joao_horarios
    to anon, authenticated;
grant select on public.joao_membros, public.joao_agendamentos, public.joao_bloqueios
    to authenticated;
grant insert, update, delete on public.joao_barbeiros, public.joao_servicos,
    public.joao_horarios to authenticated;
grant update (data, horario, status, pagamento)
    on public.joao_agendamentos to authenticated;
grant select, insert, update, delete on public.joao_bloqueios to authenticated;
grant all on public.joao_barbeiros, public.joao_servicos, public.joao_membros,
    public.joao_horarios, public.joao_agendamentos, public.joao_bloqueios to service_role;

revoke all on function public.joao_e_admin() from public, anon;
revoke all on function public.joao_barbeiro_atual() from public, anon;
revoke all on function public.joao_horarios_ocupados(uuid, date) from public;
revoke all on function public.joao_criar_agendamento(uuid, date, time, text, text, uuid[], text) from public;

grant execute on function public.joao_e_admin() to anon, authenticated;
grant execute on function public.joao_barbeiro_atual() to anon, authenticated;
grant execute on function public.joao_horarios_ocupados(uuid, date) to anon, authenticated;
grant execute on function public.joao_criar_agendamento(uuid, date, time, text, text, uuid[], text)
    to anon, authenticated;

drop policy if exists joao_barbeiros_publicos on public.joao_barbeiros;
create policy joao_barbeiros_publicos
    on public.joao_barbeiros for select to anon, authenticated
    using (
        ativo
        or (select public.joao_e_admin())
        or id = (select public.joao_barbeiro_atual())
    );
drop policy if exists joao_barbeiros_admin on public.joao_barbeiros;
create policy joao_barbeiros_admin
    on public.joao_barbeiros for all to authenticated
    using ((select public.joao_e_admin()))
    with check ((select public.joao_e_admin()));

drop policy if exists joao_servicos_publicos on public.joao_servicos;
create policy joao_servicos_publicos
    on public.joao_servicos for select to anon, authenticated
    using (
        ativo
        or (select public.joao_e_admin())
    );
drop policy if exists joao_servicos_admin on public.joao_servicos;
create policy joao_servicos_admin
    on public.joao_servicos for all to authenticated
    using ((select public.joao_e_admin()))
    with check ((select public.joao_e_admin()));

drop policy if exists joao_membros_proprio on public.joao_membros;
create policy joao_membros_proprio
    on public.joao_membros for select to authenticated
    using (
        user_id = (select auth.uid())
        or (select public.joao_e_admin())
    );

drop policy if exists joao_horarios_publicos on public.joao_horarios;
create policy joao_horarios_publicos
    on public.joao_horarios for select to anon, authenticated
    using (
        (ativo and exists (
            select 1 from public.joao_barbeiros b
            where b.id = barbeiro_id and b.ativo
        ))
        or (select public.joao_e_admin())
        or barbeiro_id = (select public.joao_barbeiro_atual())
    );
drop policy if exists joao_horarios_admin on public.joao_horarios;
create policy joao_horarios_admin
    on public.joao_horarios for all to authenticated
    using ((select public.joao_e_admin()))
    with check ((select public.joao_e_admin()));

drop policy if exists joao_agendamentos_membro_select on public.joao_agendamentos;
create policy joao_agendamentos_membro_select
    on public.joao_agendamentos for select to authenticated
    using (
        (select public.joao_e_admin())
        or barbeiro_id = (select public.joao_barbeiro_atual())
    );
drop policy if exists joao_agendamentos_membro_update on public.joao_agendamentos;
create policy joao_agendamentos_membro_update
    on public.joao_agendamentos for update to authenticated
    using (
        (select public.joao_e_admin())
        or barbeiro_id = (select public.joao_barbeiro_atual())
    )
    with check (
        (select public.joao_e_admin())
        or barbeiro_id = (select public.joao_barbeiro_atual())
    );

drop policy if exists joao_bloqueios_membro on public.joao_bloqueios;
create policy joao_bloqueios_membro
    on public.joao_bloqueios for all to authenticated
    using (
        (select public.joao_e_admin())
        or barbeiro_id = (select public.joao_barbeiro_atual())
    )
    with check (
        (select public.joao_e_admin())
        or (
            barbeiro_id = (select public.joao_barbeiro_atual())
            and criado_por = (select auth.uid())
        )
    );

commit;

-- Depois de criar a conta do João em Supabase Authentication, associe-a como
-- administrador e barbeiro. Substitua o UUID abaixo pelo ID real da conta:
--
-- insert into public.joao_membros (user_id, barbeiro_id, is_admin)
-- select
--     'UUID-DO-USUARIO-AUTH'::uuid,
--     b.id,
--     true
-- from public.joao_barbeiros b
-- where b.nome = 'João Ribeiro'
-- on conflict (user_id) do update
-- set barbeiro_id = excluded.barbeiro_id, is_admin = true;
--
-- Para cada outro barbeiro, crie a conta em Authentication e associe:
-- insert into public.joao_membros (user_id, barbeiro_id, is_admin)
-- values ('UUID-DO-USUARIO-AUTH'::uuid, 'UUID-DO-BARBEIRO'::uuid, false)
-- on conflict (user_id) do update
-- set barbeiro_id = excluded.barbeiro_id, is_admin = false;
