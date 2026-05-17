const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// middleware
app.use(express.json());

// Enhanced CORS Configuration
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  process.env.SITE_DOMAIN,
].filter(Boolean); // Removes undefined/null values

app.use(
  cors({
    origin: (origin, callback) => {
      // allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        var msg =
          "The CORS policy for this site does not " +
          "allow access from the specified Origin.";
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    credentials: true,
  })
);

// Request Logging Middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.1r2gfjh.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Database variables (initialized in run())
let db,
  mealsCollection,
  ordersCollection,
  usersCollection,
  reviewsCollection,
  favoritesCollection;

// Middleware to check DB readiness
const checkDB = (req, res, next) => {
  if (!mealsCollection) {
    return res.status(503).send({ message: "Database not connected yet" });
  }
  next();
};

//jwt middleWire
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    next();
  } catch (err) {
    console.error("JWT Verification Error:", err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// verifyAdmin
const verifyAdmin = async (req, res, next) => {
  const email = req.tokenEmail;
  const adminUser = await usersCollection.findOne({ email });

  if (!adminUser || adminUser.role !== "admin") {
    return res.status(403).send({ message: "Admin only access" });
  }
  next();
};

// Routes (outside run() to ensure registration)

app.get("/", (req, res) => {
  res.send("Local bazaar server Running");
});

app.get("/test", async (req, res) => {
  res.json({ message: "route testing" });
});

// Meal related routes
app.post("/meals", checkDB, async (req, res) => {
  const mealsData = req.body;
  const result = await mealsCollection.insertOne(mealsData);
  res.send(result);
});

app.get("/meals", checkDB, async (req, res) => {
  const page = parseInt(req.query.page) || 0;
  const limit = parseInt(req.query.limit) || 9;
  const sort = req.query.sort;

  const skip = page * limit;

  let sortOption = {};
  if (sort === "asc") {
    sortOption = { price: 1 };
  } else if (sort === "desc") {
    sortOption = { price: -1 };
  }

  const meals = await mealsCollection
    .find()
    .sort(sortOption)
    .skip(skip)
    .limit(limit)
    .toArray();

  const totalMeals = await mealsCollection.countDocuments();

  res.send({
    meals,
    totalMeals,
  });
});

app.get("/meals/:id", checkDB, async (req, res) => {
  const id = req.params.id;
  const result = await mealsCollection.findOne({ _id: new ObjectId(id) });
  res.send(result);
});

// Request Be a chef / admin
app.post("/requests", checkDB, verifyJWT, async (req, res) => {
  const request = req.body;

  if (req.tokenEmail !== request.userEmail) {
    return res.status(403).send({ message: "Forbidden access" });
  }

  const existing = await db.collection("requests").findOne({
    userEmail: request.userEmail,
    requestType: request.requestType,
    requestStatus: "pending",
  });

  if (existing) {
    return res.send({ message: "Request already pending" });
  }

  request.requestStatus = "pending";
  request.requestTime = new Date();

  const result = await db.collection("requests").insertOne(request);
  res.send(result);
});

app.get("/requests", checkDB, verifyJWT, async (req, res) => {
  const adminUser = await usersCollection.findOne({
    email: req.tokenEmail,
  });

  if (adminUser?.role !== "admin") {
    return res.status(403).send({ message: "Admin only" });
  }

  const result = await db
    .collection("requests")
    .find()
    .sort({ requestTime: -1 })
    .toArray();

  res.send(result);
});

app.patch("/requests/approve/:id", checkDB, verifyJWT, async (req, res) => {
  const requestId = req.params.id;

  const adminUser = await usersCollection.findOne({
    email: req.tokenEmail,
  });

  if (adminUser?.role !== "admin") {
    return res.status(403).send({ message: "Admin only" });
  }

  const request = await db
    .collection("requests")
    .findOne({ _id: new ObjectId(requestId) });

  if (!request) return res.status(404).send({ message: "Request not found" });

  let updateData = {};
  if (request.requestType === "chef") {
    const chefId = `chef-${Math.floor(1000 + Math.random() * 9000)}`;
    updateData = { role: "chef", chefId };
  }

  if (request.requestType === "admin") {
    updateData = { role: "admin" };
  }

  await usersCollection.updateOne(
    { email: request.userEmail },
    { $set: updateData }
  );

  await db
    .collection("requests")
    .updateOne(
      { _id: new ObjectId(requestId) },
      { $set: { requestStatus: "approved" } }
    );

  res.send({ message: "Request approved successfully" });
});

app.patch("/requests/reject/:id", checkDB, verifyJWT, async (req, res) => {
  const requestId = req.params.id;

  const adminUser = await usersCollection.findOne({
    email: req.tokenEmail,
  });

  if (adminUser?.role !== "admin") {
    return res.status(403).send({ message: "Admin only" });
  }

  await db
    .collection("requests")
    .updateOne(
      { _id: new ObjectId(requestId) },
      { $set: { requestStatus: "rejected" } }
    );

  res.send({ message: "Request rejected" });
});

// Order related API
app.post("/orders", checkDB, async (req, res) => {
  const orderData = req.body;
  orderData.status = "pending";
  orderData.paymentStatus = "pending";
  orderData.orderTime = new Date();
  const result = await ordersCollection.insertOne(orderData);
  res.send(result);
});

app.get("/orders", checkDB, async (req, res) => {
  const { chefEmail } = req.query;
  const query = chefEmail ? { chefEmail } : {};
  const result = await ordersCollection.find(query).toArray();
  res.send(result);
});

app.get("/orders/user", checkDB, verifyJWT, async (req, res) => {
  const email = req.query.email;

  if (req.tokenEmail !== email) {
    return res.status(403).send({ message: "Forbidden access" });
  }

  const result = await ordersCollection
    .find({ userEmail: email })
    .sort({ orderTime: -1 })
    .toArray();

  res.send(result);
});

// Payment related API
app.post("/create-payment-intent", checkDB, async (req, res) => {
  try {
    const { orderId, totalPrice } = req.body;

    if (!orderId || !totalPrice) {
      return res.status(400).send({ error: "Missing orderId or totalPrice" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Meal Order Payment",
            },
            unit_amount: Math.round(totalPrice * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?orderId=${orderId}`,
      cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
    });

    res.send({ url: session.url });
  } catch (error) {
    console.error("Stripe Error:", error);
    res.status(500).send({ error: error.message });
  }
});

app.patch("/orders/:id", checkDB, async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  const allowedStatus = ["pending", "accepted", "cancelled", "delivered"];
  if (!allowedStatus.includes(status)) {
    return res.status(400).send({ message: "Invalid status" });
  }

  const filter = { _id: new ObjectId(id) };
  const updateDoc = { $set: { status } };

  const result = await ordersCollection.updateOne(filter, updateDoc);
  res.send(result);
});

app.post("/payment-success", checkDB, async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).send({ error: "Order ID required" });

    const result = await ordersCollection.updateOne(
      { _id: new ObjectId(orderId) },
      { $set: { paymentStatus: "paid" } }
    );

    res.send({ success: true, result });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: error.message });
  }
});

// User routes
app.post("/users", checkDB, async (req, res) => {
  const user = req.body;
  if (!user?.email) {
    return res.status(400).send({ message: "Email is required" });
  }
  const existingUser = await usersCollection.findOne({ email: user.email });
  if (existingUser) {
    return res.send({ message: "User already exists" });
  }
  user.role = "user";
  user.status = "active";
  user.createdAt = new Date();
  const result = await usersCollection.insertOne(user);
  res.send(result);
});

app.get("/users/role/:email", checkDB, async (req, res) => {
  const email = req.params.email;
  const user = await usersCollection.findOne({ email });
  if (!user) {
    return res.status(404).send({ role: null });
  }
  res.send({ role: user.role });
});

app.get("/users", checkDB, verifyJWT, verifyAdmin, async (req, res) => {
  const users = await usersCollection.find().toArray();
  res.send(users);
});

app.patch("/users/fraud/:id", checkDB, verifyJWT, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const result = await usersCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status: "fraud" } }
  );
  res.send(result);
});

// Review routes
app.post("/reviews", checkDB, async (req, res) => {
  const review = req.body;
  review.date = new Date();
  const result = await reviewsCollection.insertOne(review);
  res.send(result);
});

app.get("/reviews/:foodId", checkDB, async (req, res) => {
  const foodId = req.params.foodId;
  const result = await reviewsCollection
    .find({ foodId })
    .sort({ date: -1 })
    .toArray();
  res.send(result);
});

app.get("/reviews", checkDB, async (req, res) => {
  const reviews = await reviewsCollection.find().toArray();
  res.send(reviews);
});

app.get("/my-reviews", checkDB, async (req, res) => {
  const email = req.query.email;
  if (!email) {
    return res.status(400).send({ message: "Email required" });
  }
  const reviews = await reviewsCollection
    .find({ userEmail: email })
    .sort({ date: -1 })
    .toArray();
  res.send(reviews);
});

app.delete("/reviews/:id", checkDB, async (req, res) => {
  const id = req.params.id;
  const result = await reviewsCollection.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});

app.patch("/reviews/:id", checkDB, async (req, res) => {
  const id = req.params.id;
  const { rating, comment } = req.body;
  const result = await reviewsCollection.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        rating,
        comment,
        date: new Date(),
      },
    }
  );
  res.send(result);
});

// Admin stats
app.get("/admin/stats", checkDB, verifyJWT, verifyAdmin, async (req, res) => {
  const totalUsers = await usersCollection.countDocuments();
  const pendingOrders = await ordersCollection.countDocuments({
    status: "pending",
  });
  const deliveredOrders = await ordersCollection.countDocuments({
    status: "delivered",
  });

  res.send({
    totalUsers,
    pendingOrders,
    deliveredOrders,
  });
});

// Favorite routes
app.post("/favorites", checkDB, async (req, res) => {
  const favorite = req.body;
  if (!favorite.userEmail || !favorite.mealId) {
    return res.status(400).send({ message: "Invalid data" });
  }
  const exists = await favoritesCollection.findOne({
    userEmail: favorite.userEmail,
    mealId: favorite.mealId,
  });
  if (exists) {
    return res.send({ message: "Already added to favorites" });
  }
  favorite.addedTime = new Date();
  const result = await favoritesCollection.insertOne(favorite);
  res.send(result);
});

app.get("/favorites", checkDB, async (req, res) => {
  const email = req.query.email;
  if (!email) {
    return res.status(400).send({ message: "Email is required" });
  }
  const result = await favoritesCollection
    .find({ userEmail: email })
    .sort({ addedTime: -1 })
    .toArray();
  res.send(result);
});

app.delete("/favorites/:id", checkDB, async (req, res) => {
  const id = req.params.id;
  const result = await favoritesCollection.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});

// Chef routes
app.get("/my-meals", checkDB, verifyJWT, async (req, res) => {
  const email = req.query.email;
  if (req.tokenEmail !== email) {
    return res.status(403).send({ message: "Forbidden access" });
  }
  const meals = await mealsCollection.find({ userEmail: email }).toArray();
  res.send(meals);
});

app.delete("/meals/:id", checkDB, verifyJWT, async (req, res) => {
  const id = req.params.id;
  const result = await mealsCollection.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});

app.patch("/meals/:id", checkDB, verifyJWT, async (req, res) => {
  const id = req.params.id;
  const updateDoc = { $set: req.body };
  const result = await mealsCollection.updateOne(
    { _id: new ObjectId(id) },
    updateDoc
  );
  res.send(result);
});

// Profile route
app.get("/users/:email", checkDB, verifyJWT, async (req, res) => {
  if (req.tokenEmail !== req.params.email) {
    return res.status(403).send({ message: "Forbidden access" });
  }
  const user = await usersCollection.findOne({ email: req.params.email });
  res.send(user);
});

async function run() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");

    db = client.db("mealsDB");
    mealsCollection = db.collection("meals");
    ordersCollection = db.collection("order_collection");
    usersCollection = db.collection("users");
    reviewsCollection = db.collection("reviews");
    favoritesCollection = db.collection("favorites");

    console.log("Collections initialized");
  } catch (error) {
    console.error("Database connection error:", error);
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
