/**
 * Static demo catalogue for the NexEats food-delivery tenant (Coimbatore).
 * All names are invented. Prices in rupees.
 */
export type Dish = [name: string, price: number, category: string, veg: boolean, bestseller: boolean, emoji: string, description: string];

export interface RestaurantSeed {
  key: string;
  name: string;
  cuisines: string;
  area: string;
  lat: number;
  lng: number;
  emoji: string;
  theme: string;
  rating: number;
  costForTwo: number;
  prepMinutes: number;
  veg: boolean;
  isOpen: boolean;
  offer: string;
  owner: [email: string, name: string];
  menu: Dish[];
}

export const CITY = { name: 'Coimbatore', lat: 11.0168, lng: 76.9558 };

export const LOCALITIES: [name: string, lat: number, lng: number][] = [
  ['Gandhipuram', 11.0176, 76.9674], ['RS Puram', 11.0081, 76.9497], ['Peelamedu', 11.0291, 77.0106],
  ['Saibaba Colony', 11.0254, 76.9395], ['Race Course', 11.0004, 76.9752], ['Ramanathapuram', 10.9978, 76.9983],
  ['Singanallur', 10.9996, 77.0312], ['Saravanampatti', 11.0789, 76.9989], ['Vadavalli', 11.0231, 76.9021],
  ['Ukkadam', 10.9891, 76.9606], ['Kuniyamuthur', 10.9652, 76.9497], ['Ganapathy', 11.0381, 76.9724],
  ['Hopes College', 11.0268, 77.0198], ['Ram Nagar', 11.0108, 76.9628], ['Sitra', 11.0398, 77.0381],
];

export const RESTAURANTS: RestaurantSeed[] = [
  {
    key: 'kbh', name: 'Kovai Biryani House', cuisines: 'Biryani · Mughlai · Kebabs', area: 'Gandhipuram', lat: 11.0185, lng: 76.9661,
    emoji: '🍗', theme: '#b45309,#f59e0b', rating: 4.4, costForTwo: 450, prepMinutes: 18, veg: false, isOpen: true, offer: '20% OFF up to ₹120',
    owner: ['partner@nexeats.test', 'Karthik Raman'],
    menu: [
      ['Chicken Dum Biryani', 249, 'Biryani', false, true, '🍛', 'Seeraga samba rice slow-cooked with tender chicken, mint and fried onions.'],
      ['Mutton Biryani', 349, 'Biryani', false, true, '🍛', 'Melt-in-the-mouth mutton layered with fragrant short-grain rice.'],
      ['Veg Dum Biryani', 199, 'Biryani', true, false, '🍚', 'Garden vegetables, paneer and whole spices on the dum.'],
      ['Egg Biryani', 179, 'Biryani', false, false, '🥚', 'Two masala eggs nestled in spiced biryani rice.'],
      ['Chicken 65', 189, 'Starters', false, true, '🍗', 'Crisp, curry-leaf tempered fried chicken.'],
      ['Mutton Seekh Kebab', 279, 'Starters', false, false, '🍢', 'Charcoal-grilled minced mutton skewers with mint chutney.'],
      ['Paneer Tikka', 219, 'Starters', true, false, '🧀', 'Tandoor-roasted cottage cheese with peppers.'],
      ['Raita', 49, 'Sides', true, false, '🥣', 'Cool onion-cucumber curd.'],
      ['Bread Halwa', 89, 'Desserts', true, false, '🍮', 'Ghee-roasted bread pudding with cashews.'],
      ['Rose Milk', 69, 'Drinks', true, false, '🥤', 'Chilled rose-syrup milk.'],
    ],
  },
  {
    key: 'mdc', name: 'Madras Dosa Co.', cuisines: 'South Indian · Tiffin', area: 'RS Puram', lat: 11.0091, lng: 76.9489,
    emoji: '🥞', theme: '#15803d,#84cc16', rating: 4.6, costForTwo: 250, prepMinutes: 12, veg: true, isOpen: true, offer: 'Free delivery',
    owner: ['owner.mdc@nexeats.test', 'Lakshmi Narayanan'],
    menu: [
      ['Ghee Roast Dosa', 129, 'Dosa', true, true, '🥞', 'Paper-thin dosa roasted in pure ghee, with three chutneys and sambar.'],
      ['Masala Dosa', 109, 'Dosa', true, true, '🥞', 'Golden dosa filled with spiced potato masala.'],
      ['Podi Onion Uttapam', 119, 'Dosa', true, false, '🫓', 'Thick uttapam with onions and gunpowder podi.'],
      ['Idli (2) & Vada', 79, 'Tiffin', true, true, '🍥', 'Soft idlis and a crisp medu vada.'],
      ['Mini Tiffin', 159, 'Tiffin', true, false, '🍱', 'Mini dosa, idli, vada, pongal and kesari.'],
      ['Ven Pongal', 99, 'Tiffin', true, false, '🍲', 'Peppery rice-lentil pongal with ghee.'],
      ['Filter Coffee', 45, 'Drinks', true, true, '☕', 'Strong decoction, frothy milk, served dabarah-style.'],
      ['Rava Kesari', 59, 'Desserts', true, false, '🍮', 'Saffron semolina sweet with cashews.'],
    ],
  },
  {
    key: 'srk', name: 'Spice Route Kitchen', cuisines: 'North Indian · Chinese', area: 'Peelamedu', lat: 11.0283, lng: 77.0071,
    emoji: '🍜', theme: '#b91c1c,#f97316', rating: 4.2, costForTwo: 400, prepMinutes: 20, veg: false, isOpen: true, offer: '₹75 OFF above ₹399',
    owner: ['owner.srk@nexeats.test', 'Arjun Mehta'],
    menu: [
      ['Butter Chicken', 279, 'Curries', false, true, '🍲', 'Smoky tandoori chicken in a velvety tomato-butter gravy.'],
      ['Paneer Butter Masala', 239, 'Curries', true, true, '🍲', 'Cottage cheese cubes in rich makhani gravy.'],
      ['Dal Makhani', 199, 'Curries', true, false, '🫘', 'Black lentils slow-simmered overnight.'],
      ['Butter Naan', 49, 'Breads', true, false, '🫓', 'Soft tandoor naan brushed with butter.'],
      ['Garlic Naan', 59, 'Breads', true, false, '🫓', 'Naan topped with garlic and coriander.'],
      ['Chicken Fried Rice', 199, 'Chinese', false, false, '🍚', 'Wok-tossed rice with egg and chicken.'],
      ['Veg Hakka Noodles', 169, 'Chinese', true, true, '🍜', 'Stir-fried noodles with crunchy vegetables.'],
      ['Chilli Paneer', 219, 'Chinese', true, false, '🌶️', 'Paneer tossed in a spicy soy-chilli glaze.'],
      ['Gulab Jamun (2)', 69, 'Desserts', true, false, '🍡', 'Warm, syrup-soaked dumplings.'],
    ],
  },
  {
    key: 'glb', name: 'Green Leaf Bowls', cuisines: 'Healthy · Salads · Bowls', area: 'Race Course', lat: 11.0012, lng: 76.9701,
    emoji: '🥗', theme: '#047857,#34d399', rating: 4.5, costForTwo: 500, prepMinutes: 10, veg: true, isOpen: true, offer: '10% OFF on first order',
    owner: ['owner.glb@nexeats.test', 'Meera Iyer'],
    menu: [
      ['Millet Buddha Bowl', 299, 'Bowls', true, true, '🥗', 'Foxtail millet, roasted veggies, hummus and greens.'],
      ['Paneer Protein Bowl', 329, 'Bowls', true, false, '🥙', 'Grilled paneer, quinoa, chickpeas and tahini.'],
      ['Greek Salad', 249, 'Salads', true, false, '🥗', 'Cucumber, olives, tomatoes and feta.'],
      ['Sprouts Chaat Salad', 179, 'Salads', true, true, '🥬', 'Tangy sprouts with pomegranate and mint.'],
      ['Avocado Toast', 269, 'Toasts', true, false, '🥑', 'Sourdough, smashed avocado, chilli flakes.'],
      ['Cold-pressed ABC Juice', 149, 'Drinks', true, true, '🧃', 'Apple, beetroot and carrot.'],
      ['Ragi Brownie', 119, 'Desserts', true, false, '🍫', 'Fudgy finger-millet brownie, no refined sugar.'],
    ],
  },
  {
    key: 'pzp', name: 'Piazza Pizzeria', cuisines: 'Pizza · Italian', area: 'Saibaba Colony', lat: 11.0262, lng: 76.9443,
    emoji: '🍕', theme: '#c2410c,#facc15', rating: 4.3, costForTwo: 600, prepMinutes: 16, veg: false, isOpen: true, offer: 'Buy 1 Get 1 on Tuesdays',
    owner: ['owner.pzp@nexeats.test', 'Daniel Joseph'],
    menu: [
      ['Margherita', 249, 'Pizza', true, true, '🍕', 'San Marzano tomato, fresh mozzarella, basil.'],
      ['Farmhouse Veggie', 329, 'Pizza', true, false, '🍕', 'Capsicum, onion, mushroom, sweet corn.'],
      ['Pepperoni Classic', 399, 'Pizza', false, true, '🍕', 'Loaded with spicy chicken pepperoni.'],
      ['Tandoori Paneer Pizza', 359, 'Pizza', true, false, '🍕', 'Indian-style paneer tikka on a thin crust.'],
      ['Penne Arrabbiata', 279, 'Pasta', true, false, '🍝', 'Penne in a fiery tomato-garlic sauce.'],
      ['Alfredo Chicken Pasta', 329, 'Pasta', false, false, '🍝', 'Creamy parmesan sauce with grilled chicken.'],
      ['Garlic Breadsticks', 129, 'Sides', true, true, '🥖', 'Buttery breadsticks with cheese dip.'],
      ['Tiramisu Jar', 179, 'Desserts', true, false, '🍰', 'Coffee-soaked layers with mascarpone.'],
    ],
  },
  {
    key: 'bbn', name: 'Burger Barn', cuisines: 'Burgers · Fast Food', area: 'Avinashi Road', lat: 11.0239, lng: 76.9898,
    emoji: '🍔', theme: '#9a3412,#fb923c', rating: 4.1, costForTwo: 350, prepMinutes: 10, veg: false, isOpen: true, offer: 'Combos from ₹199',
    owner: ['owner.bbn@nexeats.test', 'Rahul Varghese'],
    menu: [
      ['Classic Chicken Burger', 179, 'Burgers', false, true, '🍔', 'Crispy chicken, lettuce, house mayo.'],
      ['Double Smash Burger', 259, 'Burgers', false, true, '🍔', 'Two smashed patties, cheddar, pickles.'],
      ['Aloo Tikki Burger', 99, 'Burgers', true, false, '🍔', 'Spiced potato patty with tangy sauce.'],
      ['Paneer Crunch Burger', 169, 'Burgers', true, false, '🍔', 'Crumb-fried paneer with peri-peri mayo.'],
      ['Peri-Peri Fries', 119, 'Sides', true, true, '🍟', 'Crisp fries dusted with peri-peri.'],
      ['Chicken Wings (6)', 219, 'Sides', false, false, '🍗', 'Smoky BBQ glazed wings.'],
      ['Oreo Shake', 149, 'Shakes', true, true, '🥤', 'Thick cookies-and-cream shake.'],
    ],
  },
  {
    key: 'cst', name: 'Chaat Street', cuisines: 'Chaat · Street Food', area: 'Town Hall', lat: 10.9957, lng: 76.9612,
    emoji: '🥙', theme: '#be185d,#f472b6', rating: 4.3, costForTwo: 200, prepMinutes: 8, veg: true, isOpen: true, offer: 'Flat ₹50 OFF',
    owner: ['owner.cst@nexeats.test', 'Pooja Sharma'],
    menu: [
      ['Pani Puri (8)', 69, 'Chaat', true, true, '🫧', 'Crisp puris with spicy mint water.'],
      ['Bhel Puri', 79, 'Chaat', true, false, '🥗', 'Puffed rice, sev, chutneys and onions.'],
      ['Samosa Chaat', 99, 'Chaat', true, true, '🥟', 'Crushed samosa with chole, curd and chutneys.'],
      ['Pav Bhaji', 129, 'Mains', true, true, '🍞', 'Buttery bhaji with toasted pav.'],
      ['Vada Pav (2)', 79, 'Mains', true, false, '🍔', 'Mumbai-style spicy potato fritter in pav.'],
      ['Masala Chai', 35, 'Drinks', true, true, '🍵', 'Ginger-cardamom tea.'],
      ['Kulfi Falooda', 119, 'Desserts', true, false, '🍨', 'Malai kulfi with falooda and rose syrup.'],
    ],
  },
  {
    key: 'swt', name: 'Sweet Tooth Desserts', cuisines: 'Desserts · Ice Cream · Cakes', area: 'Ramanathapuram', lat: 10.9986, lng: 76.9938,
    emoji: '🍰', theme: '#7c3aed,#f0abfc', rating: 4.7, costForTwo: 300, prepMinutes: 6, veg: true, isOpen: true, offer: '15% OFF above ₹299',
    owner: ['owner.swt@nexeats.test', 'Nisha Fernandes'],
    menu: [
      ['Death by Chocolate', 199, 'Sundaes', true, true, '🍫', 'Brownie, chocolate ice cream, fudge sauce.'],
      ['Red Velvet Pastry', 129, 'Cakes', true, false, '🍰', 'Cream-cheese frosted red velvet.'],
      ['Belgian Waffle', 169, 'Waffles', true, true, '🧇', 'Crisp waffle with Nutella drizzle.'],
      ['Tender Coconut Ice Cream', 99, 'Ice Cream', true, true, '🥥', 'Fresh tender coconut scoops.'],
      ['Gulkand Rasmalai', 149, 'Indian Sweets', true, false, '🍮', 'Soft rasmalai with rose-petal gulkand.'],
      ['Cold Coffee', 119, 'Drinks', true, false, '🧋', 'Iced coffee blended with ice cream.'],
    ],
  },
  {
    key: 'chm', name: 'Chettinad Mess', cuisines: 'Chettinad · Seafood', area: 'Singanallur', lat: 10.9993, lng: 77.0297,
    emoji: '🦐', theme: '#7f1d1d,#ef4444', rating: 4.5, costForTwo: 500, prepMinutes: 22, veg: false, isOpen: false, offer: 'Opens at 6 PM',
    owner: ['owner.chm@nexeats.test', 'Senthil Kumar'],
    menu: [
      ['Chettinad Chicken Curry', 269, 'Curries', false, true, '🍛', 'Fiery kalpasi and marathi-mokku spiced chicken.'],
      ['Nethili Fry', 229, 'Seafood', false, true, '🐟', 'Crisp-fried anchovies with curry leaves.'],
      ['Prawn Thokku', 329, 'Seafood', false, false, '🦐', 'Prawns in a thick roasted masala.'],
      ['Kothu Parotta', 169, 'Parotta', false, true, '🫓', 'Shredded parotta tossed with egg and salna.'],
      ['Veg Meals', 179, 'Meals', true, false, '🍱', 'Rice, sambar, rasam, poriyal, kootu, appalam.'],
      ['Elaneer Payasam', 99, 'Desserts', true, false, '🥥', 'Tender-coconut kheer.'],
    ],
  },
  {
    key: 'ttc', name: 'Tea Time Café', cuisines: 'Café · Snacks · Beverages', area: 'Saravanampatti', lat: 11.0771, lng: 76.9972,
    emoji: '☕', theme: '#78350f,#d6a75b', rating: 4.2, costForTwo: 200, prepMinutes: 7, veg: true, isOpen: true, offer: 'Chai + snack @ ₹79',
    owner: ['owner.ttc@nexeats.test', 'Gokul Prasad'],
    menu: [
      ['Ginger Chai', 30, 'Tea', true, true, '🍵', 'Strong tea brewed with fresh ginger.'],
      ['Sulaimani', 35, 'Tea', true, false, '🫖', 'Spiced black tea with lemon.'],
      ['Onion Samosa (4)', 60, 'Snacks', true, true, '🥟', 'Mini samosas with a crunchy onion filling.'],
      ['Bun Butter Jam', 50, 'Snacks', true, false, '🍞', 'Toasted bun with butter and jam.'],
      ['Veg Puff', 35, 'Snacks', true, true, '🥐', 'Flaky bakery puff with spiced veg.'],
      ['Mysore Bonda (4)', 55, 'Snacks', true, false, '🧆', 'Soft fritters with coconut chutney.'],
      ['Badam Milk', 60, 'Drinks', true, false, '🥛', 'Warm almond-saffron milk.'],
    ],
  },
];

export const RIDERS: [email: string, name: string, vehicle: string, phone: string][] = [
  ['rider@nexeats.test', 'Ravi Shankar', 'Scooter', '98430 10001'],
  ['rider1@nexeats.test', 'Muthu Kumar', 'Bike', '98430 10002'],
  ['rider2@nexeats.test', 'Siva Prakash', 'EV scooter', '98430 10003'],
  ['rider3@nexeats.test', 'Anand Raj', 'Bike', '98430 10004'],
  ['rider4@nexeats.test', 'Farhan Ali', 'Scooter', '98430 10005'],
  ['rider5@nexeats.test', 'Dinesh Babu', 'Bike', '98430 10006'],
  ['rider6@nexeats.test', 'Joseph Vijay', 'EV scooter', '98430 10007'],
  ['rider7@nexeats.test', 'Kavin Selvam', 'Bike', '98430 10008'],
  ['rider8@nexeats.test', 'Prakash Mani', 'Scooter', '98430 10009'],
];

export const DINERS: string[] = [
  'Aditi Rao', 'Bala Murugan', 'Catherine D', 'Deepak N', 'Esther M', 'Ganesh K', 'Harini S', 'Imran Khan', 'Janani R', 'Kishore V',
  'Lavanya P', 'Manoj T', 'Nandhini A', 'Om Prakash', 'Preethi L', 'Rohit Nair', 'Sangeetha B', 'Tharun M', 'Uma Devi', 'Vignesh J',
  'Yamini K', 'Zubair A', 'Abinaya C', 'Bharath S',
];

export const COUPONS = [
  { code: 'WELCOME50', title: '50% OFF up to ₹100 on your first orders', kind: 'percent', value: 50, maxDiscount: 100, minOrder: 149, active: true, theme: '#ea580c,#f59e0b' },
  { code: 'FEAST20', title: '20% OFF up to ₹150 on orders above ₹499', kind: 'percent', value: 20, maxDiscount: 150, minOrder: 499, active: true, theme: '#7c3aed,#ec4899' },
  { code: 'FREEDEL', title: 'Free delivery on orders above ₹199', kind: 'free_delivery', value: 0, maxDiscount: 60, minOrder: 199, active: true, theme: '#0d9488,#22c55e' },
  { code: 'FLAT75', title: 'Flat ₹75 OFF on orders above ₹399', kind: 'flat', value: 75, maxDiscount: 75, minOrder: 399, active: true, theme: '#be123c,#f97316' },
];

/** Workflow definitions (stored as data; editable at runtime). */
export const ORDER_WORKFLOW = {
  initial: 'placed',
  states: {
    placed: { label: 'Order placed' },
    accepted: { label: 'Preparing' },
    ready: { label: 'Ready for pickup' },
    picked_up: { label: 'Out for delivery' },
    delivered: { label: 'Delivered', final: true },
    cancelled: { label: 'Cancelled', final: true },
    rejected: { label: 'Declined by restaurant', final: true },
  },
  transitions: [
    { name: 'accept', label: 'Accept order', from: 'placed', to: 'accepted' },
    { name: 'reject', label: 'Decline', from: 'placed', to: 'rejected', requireComment: true },
    { name: 'cancel', label: 'Cancel order', from: 'placed', to: 'cancelled', by: { owner: true } },
    { name: 'ready', label: 'Mark food ready', from: 'accepted', to: 'ready' },
    { name: 'pick_up', label: 'Picked up', from: 'ready', to: 'picked_up', by: { roles: ['system'] } },
    { name: 'deliver', label: 'Delivered', from: 'picked_up', to: 'delivered', by: { roles: ['system'] } },
  ],
};

export const DELIVERY_WORKFLOW = {
  initial: 'assigned',
  states: {
    assigned: { label: 'Heading to restaurant' },
    picked_up: { label: 'On the way to customer' },
    delivered: { label: 'Delivered', final: true },
    cancelled: { label: 'Cancelled', final: true },
  },
  transitions: [
    { name: 'pick_up', label: 'Picked up', from: 'assigned', to: 'picked_up' },
    { name: 'deliver', label: 'Delivered', from: 'picked_up', to: 'delivered' },
    { name: 'cancel', label: 'Cancel', from: ['assigned', 'picked_up'], to: 'cancelled', by: { roles: ['system', 'admin'] } },
  ],
};

type F = { name: string; label: string; type: string; required?: boolean; options?: string[]; lookupEntity?: string; pii?: boolean };
const f = (name: string, label: string, type: string, extra: Partial<F> = {}): F => ({ name, label, type, ...extra });

export const ENTITIES: { name: string; label: string; pluralLabel: string; icon: string; numbering?: string; workflowKey?: string; fields: F[] }[] = [
  {
    name: 'restaurant', label: 'Restaurant', pluralLabel: 'Restaurants', icon: 'storefront',
    fields: [
      f('name', 'Name', 'text', { required: true }), f('area', 'Area', 'text'), f('cuisines', 'Cuisines', 'text'),
      f('rating', 'Rating', 'number'), f('isOpen', 'Open now', 'boolean'), f('costForTwo', 'Cost for two', 'money'),
      f('prepMinutes', 'Prep minutes', 'number'), f('veg', 'Pure veg', 'boolean'), f('offer', 'Offer', 'text'),
      f('ratingCount', 'Ratings', 'number'), f('emoji', 'Emoji', 'text'), f('theme', 'Theme colours', 'text'),
      f('lat', 'Latitude', 'number'), f('lng', 'Longitude', 'number'), f('phone', 'Phone', 'phone'),
    ],
  },
  {
    name: 'menu_item', label: 'Menu item', pluralLabel: 'Menu items', icon: 'restaurant_menu',
    fields: [
      f('name', 'Name', 'text', { required: true }), f('restaurantName', 'Restaurant', 'text'), f('category', 'Category', 'text'),
      f('price', 'Price', 'money', { required: true }), f('available', 'Available', 'boolean'), f('veg', 'Veg', 'boolean'),
      f('bestseller', 'Bestseller', 'boolean'), f('restaurantId', 'Restaurant ID', 'lookup', { lookupEntity: 'restaurant', required: true }),
      f('emoji', 'Emoji', 'text'), f('description', 'Description', 'textarea'),
    ],
  },
  {
    name: 'order', label: 'Order', pluralLabel: 'Orders', icon: 'receipt_long', numbering: 'NE-{#####}', workflowKey: 'order-lifecycle',
    fields: [
      f('customerName', 'Customer', 'text'), f('restaurantName', 'Restaurant', 'text'), f('total', 'Total', 'money'),
      f('paymentMethod', 'Payment', 'select', { options: ['upi', 'card', 'cod'] }),
      f('paymentStatus', 'Payment status', 'select', { options: ['paid', 'cod_pending', 'cod_collected', 'refunded'] }),
      f('itemCount', 'Items', 'number'), f('riderName', 'Rider', 'text'),
      f('restaurantId', 'Restaurant ID', 'lookup', { lookupEntity: 'restaurant' }), f('items', 'Line items', 'json'),
      f('itemTotal', 'Item total', 'money'), f('deliveryFee', 'Delivery fee', 'money'), f('platformFee', 'Platform fee', 'money'),
      f('taxes', 'Taxes', 'money'), f('discount', 'Discount', 'money'), f('coupon', 'Coupon', 'text'), f('paymentRef', 'Payment ref', 'text'),
      f('address', 'Delivery address', 'textarea'), f('dropLat', 'Drop latitude', 'number'), f('dropLng', 'Drop longitude', 'number'),
      f('distanceKm', 'Distance (km)', 'number'), f('etaMinutes', 'Promised ETA (min)', 'number'),
      f('notes', 'Cooking instructions', 'textarea'), f('prepSeconds', 'Demo prep seconds', 'number'),
      f('deliveryId', 'Delivery ID', 'text'), f('riderId', 'Rider user ID', 'text'), f('riderPhone', 'Rider phone', 'phone'), f('riderVehicle', 'Rider vehicle', 'text'),
      f('foodRating', 'Food rating', 'number'), f('riderRating', 'Rider rating', 'number'), f('review', 'Review', 'textarea'),
      f('deliveredAt', 'Delivered at', 'datetime'), f('deliveryMinutes', 'Delivery minutes', 'number'), f('cancelReason', 'Cancel / decline reason', 'textarea'),
    ],
  },
  {
    name: 'delivery', label: 'Delivery', pluralLabel: 'Deliveries', icon: 'two_wheeler', numbering: 'DL-{#####}', workflowKey: 'delivery-lifecycle',
    fields: [
      f('orderNumber', 'Order', 'text'), f('riderName', 'Rider', 'text'), f('restaurantName', 'Restaurant', 'text'),
      f('customerName', 'Customer', 'text'), f('payout', 'Rider payout', 'money'), f('distanceKm', 'Distance (km)', 'number'),
      f('orderId', 'Order ID', 'text'), f('address', 'Drop address', 'textarea'),
      f('startLat', 'Rider start lat', 'number'), f('startLng', 'Rider start lng', 'number'),
      f('pickupLat', 'Pickup lat', 'number'), f('pickupLng', 'Pickup lng', 'number'), f('dropLat', 'Drop lat', 'number'), f('dropLng', 'Drop lng', 'number'),
      f('approachSeconds', 'Demo approach seconds', 'number'), f('travelSeconds', 'Demo travel seconds', 'number'),
      f('assignedAt', 'Assigned at', 'datetime'), f('pickedUpAt', 'Picked up at', 'datetime'), f('deliveredAt', 'Delivered at', 'datetime'),
    ],
  },
  {
    name: 'rider_profile', label: 'Rider', pluralLabel: 'Riders', icon: 'sports_motorsports',
    fields: [
      f('name', 'Name', 'text', { required: true }), f('vehicle', 'Vehicle', 'select', { options: ['Bike', 'Scooter', 'EV scooter', 'Bicycle'] }),
      f('online', 'Online', 'boolean'), f('rating', 'Rating', 'number'), f('zone', 'Zone', 'text'), f('phone', 'Phone', 'phone'),
      f('bot', 'Simulated rider', 'boolean'), f('lat', 'Latitude', 'number'), f('lng', 'Longitude', 'number'),
    ],
  },
  {
    name: 'coupon', label: 'Coupon', pluralLabel: 'Coupons', icon: 'sell',
    fields: [
      f('code', 'Code', 'text', { required: true }), f('title', 'Title', 'text'), f('kind', 'Kind', 'select', { options: ['percent', 'flat', 'free_delivery'] }),
      f('value', 'Value', 'number'), f('maxDiscount', 'Max discount', 'money'), f('minOrder', 'Minimum order', 'money'),
      f('active', 'Active', 'boolean'), f('theme', 'Theme colours', 'text'),
    ],
  },
];
