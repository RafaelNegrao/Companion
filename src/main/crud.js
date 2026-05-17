const { supabase } = require('./supabase-config');

function normalizarFiltros(filters) {
  if (!filters) return [];

  if (Array.isArray(filters)) {
    return filters.filter(Boolean);
  }

  return Object.entries(filters).map(([column, value]) => ({
    column,
    op: 'eq',
    value
  }));
}

function aplicarFiltros(query, filters) {
  normalizarFiltros(filters).forEach((filter) => {
    const column = filter.column;
    const op = filter.op || 'eq';
    const value = filter.value;

    if (!column || typeof query[op] !== 'function') return;
    query = query[op](column, value);
  });

  return query;
}

function aplicarOrdenacao(query, order) {
  const orders = Array.isArray(order) ? order : (order ? [order] : []);

  orders.forEach((item) => {
    if (!item?.column) return;
    query = query.order(item.column, {
      ascending: item.ascending !== false
    });
  });

  return query;
}

function aplicarResultadoUnico(query, options) {
  if (options.single) return query.single();
  if (options.maybeSingle) return query.maybeSingle();
  return query;
}

async function select(table, options = {}) {
  let query = supabase
    .from(table)
    .select(options.columns || '*');

  query = aplicarFiltros(query, options.filters);
  query = aplicarOrdenacao(query, options.order);

  if (Number.isInteger(options.limit)) {
    query = query.limit(options.limit);
  }

  return aplicarResultadoUnico(query, options);
}

async function findOne(table, options = {}) {
  return select(table, {
    ...options,
    maybeSingle: options.single ? false : options.maybeSingle !== false,
    limit: options.limit
  });
}

async function insert(table, payload, options = {}) {
  const rows = Array.isArray(payload) ? payload : [payload];
  let query = supabase
    .from(table)
    .insert(rows);

  if (options.columns !== false) {
    query = query.select(options.columns || '*');
  }

  return aplicarResultadoUnico(query, options);
}

async function update(table, payload, options = {}) {
  let query = supabase
    .from(table)
    .update(payload);

  query = aplicarFiltros(query, options.filters);

  if (options.columns !== false) {
    query = query.select(options.columns || '*');
  }

  return aplicarResultadoUnico(query, options);
}

async function upsert(table, payload, options = {}) {
  let query = supabase
    .from(table)
    .upsert(payload, {
      onConflict: options.onConflict,
      ignoreDuplicates: options.ignoreDuplicates === true
    });

  if (options.columns !== false) {
    query = query.select(options.columns || '*');
  }

  return aplicarResultadoUnico(query, options);
}

async function remove(table, options = {}) {
  let query = supabase
    .from(table)
    .delete();

  query = aplicarFiltros(query, options.filters);
  return query;
}

module.exports = {
  select,
  findOne,
  insert,
  update,
  upsert,
  remove
};
