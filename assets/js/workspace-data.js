/* Connect the reference workspace components to MediDesk's existing APIs. */
const WorkspaceData = (() => {
  const permissionFields = ['perm_products', 'perm_categories', 'perm_transactions', 'perm_users', 'perm_settings'];
  let api;
  let store;
  let platform = {};
  let categoryRecords = [];
  let productRecords = [];
  let customerRecords = [];
  let userRecords = [];
  let transactionRecords = [];
  let settingsRecord;
  let currentUser;
  const decode = value => {
    const element = document.createElement('textarea');
    element.innerHTML = String(value ?? '');
    return element.value;
  };
  const userFrom = record => ({
    id: Number(record._id), name: decode(record.fullname || record.name || record.username),
    username: decode(record.username), status: decode(record.status),
    permissions: permissionFields.flatMap((key, i) => Number(record[key]) === 1 ? [i] : [])
  });
  async function request(route, method = 'GET', body) {
    const response = await fetch(api + route, {
      method,
      ...(body instanceof FormData ? {body} : body === undefined ? {} : {
        headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Could not save or load pharmacy data (${response.status}). Please try again.`);
    const text = await response.text();
    try { return JSON.parse(text); } catch { return text; }
  }
  function form(values) {
    const body = new FormData();
    Object.entries(values).forEach(([key, value]) => body.append(key, value ?? ''));
    return body;
  }
  function imageURL(filename, fallback = '') {
    if (!filename) return fallback;
    const {pathToFileURL} = require('url');
    const file = require('path').join(process.env.APPDATA, process.env.APPNAME, 'uploads', filename);
    return require('fs').existsSync(file) ? pathToFileURL(file).href : fallback;
  }
  function productFrom(record) {
    return {
      id:Number(record._id), name:decode(record.name),
      category:decode(categoryRecords.find(c => String(c._id) === String(record.category))?.name || record.category),
      supplier:decode(record.supplier), price:Number(record.price) || 0,
      stock:Number(record.quantity) || 0,min:Number(record.minStock) || 0,stockCheck:Number(record.stock) !== 0,
      expiry:record.expirationDate?.slice(0,10) || '',sku:String(record.barcode ?? ''),
      legacyNumericBarcode:typeof record.barcode === 'number',image:imageURL(record.img),hasImage:!!record.img
    };
  }
  const customerIdFor = rawId => customerRecords.findIndex(c => String(c._id) === String(rawId)) + 1;
  function orderFrom(record) {
    const lines = (record.lines || record.items || []).map(line => ({
      id: Number(line.id), name: decode(line.name || line.product_name), price: Number(line.price), qty: Number(line.qty ?? line.quantity)
    }));
    return {
      id: String(record._id), date: new Date(record.date).toISOString(),
      customer: record.customerName || record.customer?.username || decode(customerRecords.find(c => String(c._id) === String(record.customer?.id ?? record.customer))?.name) || 'Walk-in customer',
      lines, subtotal: Number(record.subtotal), discount: Number(record.discount) || 0,
      tax: Number(record.tax) || 0, total: Number(record.total),
      method: record.method || record.payment_type || '',
      received: Number(record.paid), cashier: decode(record.user), till: record.till || '', status:Number(record.status) === 1 ? 'Paid' : 'Unpaid'
    };
  }
  async function load() {
    const results = await Promise.all([
      request('categories/all'), request('inventory/products'), request('customers/all'),
      request('users/all'), request('all'), request('settings/get')
    ]);
    [categoryRecords, productRecords, customerRecords, userRecords, transactionRecords, settingsRecord] = results;
    categories = categoryRecords.map(c => decode(c.name));
    products = productRecords.map(productFrom);
    customers = customerRecords.map((c, index) => ({id:index + 1, name:decode(c.name),phone:decode(c.phone),email:decode(c.email),address:decode(c.address)}));
    users = userRecords.map(userFrom);
    const active = users.find(u => u.id === currentUser.id);
    if (!active) throw new Error('Your account no longer exists. Please sign in again.');
    currentUser = active;
    orders = transactionRecords.filter(t => Number(t.status) === 1).map(orderFrom).sort((a,b) => b.date.localeCompare(a.date));
    held = transactionRecords.filter(t => Number(t.status) === 0).map((t,index) => ({
      id:index + 1, rawId:t._id, reference:t.ref_number || "", date:new Date(t.date).toISOString(), customerId:customerIdFor(t.customer?.id ?? t.customer),
      discount:Number(t.discount) || 0,
      cart:(t.items || []).map(l => ({id:Number(l.id),qty:Number(l.quantity ?? l.qty)}))
    }));
    if (settingsRecord?.settings) {
      const saved = settingsRecord.settings;

      settings = {
        ...settings, name:(!saved.store || /^mcure(?: pharmacy)?$/i.test(decode(saved.store).trim())) ? "MediDesk Pharmacy" : decode(saved.store), application:platform.app || decode(saved.app),
        address1:decode(saved.address_one), address2:decode(saved.address_two), phone:decode(saved.contact),
        symbol:decode(saved.symbol),
        taxNumber:decode(saved.tax), tax:Number(saved.percentage) || 0,
        chargeTax:!!saved.charge_tax, quickBilling:!!saved.quick_billing,
        receiptFooter:decode(saved.footer), logo:saved.logoData || ''
      };
      if (!settings.logo && saved.img && typeof require === 'function') {
        const {pathToFileURL} = require('url');
        settings.logo = pathToFileURL(require('path').join(process.env.APPDATA, process.env.APPNAME, 'uploads', saved.img)).href;
      }
    }
    document.title = settings.name ? `${settings.name} — MediDesk` : 'MediDesk';
  }
  function canVisit(page) {
    if (!currentUser) return false;
    const permission = {products:0,categories:1,transactions:2,users:3,settings:4}[page];
    return permission === undefined || currentUser.permissions.includes(permission);
  }
  async function initialize() {
    if (typeof require !== 'function') throw new Error('Open MediDesk with npm start to connect to your pharmacy database.');
    const Store = require('electron-store');
    store = new Store();
    platform = store.get('settings') || {};
    const host = platform.app === 'Network Point of Sale Terminal' ? platform.ip : 'localhost';
    const port = platform.app === 'Network Point of Sale Terminal' ? platform.port || '3210' : process.env.PORT || '3210';
    api = `http://${host}:${port}/api/`;
    const policy = document.createElement('meta');
    policy.id = 'workspace-policy';
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: file:; font-src 'self'; connect-src ${new URL(api).origin}; base-uri 'self'; form-action 'self'`;
    document.head.appendChild(policy);
    // Keep native menu commands connected to the redesigned controls.
    require('electron').ipcRenderer.on('click-element', (_event, id) => {
      const actions = {
        pointofsale:() => navigate('pos'), transactions:() => navigate('transactions'),
        productModal:() => navigate('products'), categoryModal:() => navigate('categories'),
        settings:() => navigate('settings'), usersModal:() => navigate('users'),
        newProductModal:() => canVisit('products') && editProduct(),
        newCategoryModal:() => canVisit('categories') && editCategory(),
        newCustomerModal:() => editCustomer(), 'log-out':signOut
      };
      if (currentUser) actions[id]?.();
    });
    const savedUser = store.get('user');
    if (store.get('auth')?.auth && savedUser) {
      currentUser = userFrom(savedUser);
      await load();
      restoreDraft();
      openWorkspace();
    }
  }
  async function login(username, password, remember) {
    // Existing installations already have an administrator; initialize only for a new database.
    const existing = await request('users/all');
    if (!existing.length) await request('users/check');
    const result = await request('users/login', 'POST', {username, password});
    if (!result.auth) throw new Error('Incorrect username or password.');
    currentUser = userFrom(result);
    await load();
    if (remember) {
      store.set('auth', {auth:true});
      const {password: _password, ...profile} = result;
      store.set('user', profile);
    }
    restoreDraft();
    openWorkspace();
  }
  async function logout() {
    saveDraft();
    if (currentUser) await request(`users/logout/${currentUser.id}`);
    store.delete('auth'); store.delete('user');
    currentUser = null;
    cart = []; customerId = 0; discount = 0;
    showLogin();
  }
  async function saveProduct(record, id, image, removeImage) {
    if (!canVisit('products')) throw new Error('Product access is required.');
    const raw = productRecords.find(p => Number(p._id) === id);
    const category = categoryRecords.find(c => decode(c.name) === record.category);
    const body = form({id:id || '',name:record.name,barcode:record.sku,
      category:category?._id || '',expirationDate:record.expiry,price:record.price,
      quantity:record.stock,minStock:record.min,supplier:record.supplier,
      stock:record.stockCheck ? '' : 'on',img:raw?.img || '',remove:removeImage ? '1' : '0'});
    if (image?.size) body.append('imagename',image);
    await request('inventory/product','POST',body);
    productRecords = await request('inventory/products');
    const saved = id ? productRecords.find(p => Number(p._id) === id) : productRecords.find(p => String(p.barcode) === record.sku);
    return productFrom(saved);
  }
  async function deleteProduct(id) {
    if (!canVisit('products')) throw new Error('Product access is required.');
    await request(`inventory/product/${id}`,'DELETE');
    productRecords = productRecords.filter(p=>Number(p._id)!==id);
  }
  async function deleteUser(id) {
    if (!canVisit('users') || id===currentUser.id) throw new Error('User management access is required.');
    await request(`users/user/${id}`,'DELETE');
  }
  async function saveCategory(name, old) {
    if (!canVisit('categories')) throw new Error('Category access is required.');
    const raw = categoryRecords.find(c => decode(c.name) === old);
    await request('categories/category', raw ? 'PUT' : 'POST', {...raw,id:raw?._id,name});
    categoryRecords = await request('categories/all');
  }
  async function deleteCategory(name) {
    if (!canVisit('categories')) throw new Error('Category access is required.');
    const raw = categoryRecords.find(c => decode(c.name) === name);
    await request(`categories/category/${raw._id}`, 'DELETE');
    categoryRecords = await request('categories/all');
  }
  async function saveCustomer(record, id) {
    const raw = id ? customerRecords[id - 1] : null;
    const body = {...raw,_id:raw?._id || String(Date.now()),name:record.name,phone:record.phone,email:record.email,address:record.address};
    await request('customers/customer', raw ? 'PUT' : 'POST', body);
    if (raw) customerRecords[id - 1] = body;
    else { customerRecords.push(body); record.id = customerRecords.length; }
  }
  async function saveUser(record, id, password) {
    if (!canVisit('users') && id !== currentUser.id) throw new Error('User management access is required.');
    const permissions = canVisit('users') ? record.permissions : currentUser.permissions;
    const body = {id:id || '',fullname:record.name,username:record.username,

      ...Object.fromEntries(permissionFields.map((key,i) => [key,permissions.includes(i) ? 'on' : 'off']))};
    if (password) body.password = password;
    if (!id && !password) throw new Error('A password is required.');
    const result = await request('users/post', 'POST', body);
    if (id === currentUser.id) { currentUser = {...record,permissions}; if (store.get('user')) store.set('user', {...store.get('user'), ...body}); }
    return id || Number(result._id);
  }
  function transaction(order, status = 1) {
    const customer = customerRecords[customerId - 1];
    return {
      _id:order.id,order:order.id,ref_number:status === 0 ? order.reference || '' : '',
      status,customer:customer ? {id:customer._id,username:customer.name} : 0,customerName:order.customer,
      subtotal:order.subtotal || 0,discount:order.discount || 0,tax:order.tax || 0,
      total:order.total || 0,paid:status === 1 ? order.received : 0,
      change:Math.max(0,(order.received || 0)-(order.total || 0)),
      date:order.date,method:order.method,payment_type:order.method,
      payment_info:order.paymentInfo || '',order_type:1,till:platform.till || '',user:currentUser.name,user_id:currentUser.id,
      lines:order.lines,items:(order.lines || []).map(l => ({...l,quantity:l.qty,product_name:l.name}))
    };
  }
  async function saveOrder(order) {
    // Timestamp IDs avoid collisions across restarts and existing MC order numbers.
    order.id = `MC-${Date.now()}`;
    const body = transaction(order);
    await request('new','POST',body);
    transactionRecords.push(body);
    order.till = body.till;
  }
  async function saveHeld(tab) {
    const body = transaction({id:String(tab.id),reference:tab.reference,date:tab.date,discount:tab.discount,
      customer:customerName(tab.customerId), ...calculate(tab.cart,tab.discount),
      lines:tab.cart.map(l => ({...products.find(p => p.id === l.id),qty:l.qty}))},0);
    await request('new','POST',body);
    tab.rawId = body._id;
    transactionRecords.push(body);
  }
  async function removeHeld(id) {
    const tab = held.find(t => t.id === id);
    await request('delete','POST',{orderId:tab.rawId});
    transactionRecords = transactionRecords.filter(t=>t._id!==tab.rawId);
  }
  async function saveSettings(draft) {
    if (!canVisit('settings')) throw new Error('Settings access is required.');
    const terminal = draft.application === 'Network Point of Sale Terminal';
    if (terminal && (!draft.ip || !draft.till)) throw new Error('Server IP Address and Till Number are required.');
    const nextAPI = terminal ? `http://${draft.ip}:${platform.port || '3210'}/api/` : `http://localhost:${process.env.PORT || '3210'}/api/`;
    // Save store details to the current server; connection settings belong to this terminal.
    await request('settings/post','POST',form({
      id:settingsRecord?._id || '',app:draft.application,store:draft.name,
      address_one:draft.address1,address_two:draft.address2,contact:draft.phone,
      tax:draft.taxNumber,symbol:draft.symbol,percentage:draft.tax,charge_tax:draft.chargeTax ? 'on' : '',
      quick_billing:draft.quickBilling ? 'on' : '',footer:draft.receiptFooter,
      logoData:draft.logo.startsWith('data:image/') ? draft.logo : '',
      img:draft.logo ? settingsRecord?.settings?.img || '' : '',remove:'0'
    }));
    platform = {...platform,app:draft.application,ip:draft.ip,till:draft.till,mac:draft.mac};
    store.set('settings',platform);
    settingsRecord = await request('settings/get');
    if (api !== nextAPI) {
      saveDraft(); store.delete('auth'); store.delete('user'); currentUser = null;
      return true;
    }
    return false;
  }
  function saveDraft() {
    if (store && currentUser) store.set(`workspaceDraft${currentUser.id}`, {cart,customerId,discount});
  }
  function restoreDraft() {
    const draft = store.get(`workspaceDraft${currentUser.id}`);
    if (draft) { cart = draft.cart.filter(l => products.some(p => p.id === l.id)); customerId = draft.customerId; discount = draft.discount; }
  }
  window.addEventListener('beforeunload', saveDraft);
  return {initialize,login,logout,canVisit,saveProduct,deleteProduct,deleteUser,saveCategory,deleteCategory,saveCustomer,saveUser,saveOrder,saveHeld,removeHeld,saveSettings,
    get transactions() { return transactionRecords.map(orderFrom); },
    get currentUser() { return currentUser; },
    get connection() {
      const mac = Object.values(require('os').networkInterfaces()).flat().find(n => n.mac && n.mac !== '00:00:00:00:00:00')?.mac || '';
      return {application:platform.app || settings.application,ip:platform.ip || '',till:platform.till || '',mac:platform.mac || mac};
    }};
})();

async function signIn(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  document.getElementById('login-status').textContent = 'Signing in…';
  try {
    await WorkspaceData.login(form.elements.username.value.trim(), form.elements.password.value, true);
    form.elements.password.value = '';
    document.getElementById('login-status').textContent = '';
  } catch (error) { document.getElementById('login-status').textContent = error.message; }
  finally { button.disabled = false; }
}
async function signOut() {
  try { await WorkspaceData.logout(); } catch (error) { toast(error.message); }
}
