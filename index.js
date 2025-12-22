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
app.use(
  cors({
    origin: process.env.SITE_DOMAIN,

    credentials: true,
  })
);

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.1r2gfjh.mongodb.net/?appName=Cluster0`;

app.get("/", (req, res) => {
  res.send("Local bazaar server deploy");
});

//jwt middleWire
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const db = client.db("mealsDB");
    const mealsCollection = db.collection("meals");
    const ordersCollection = db.collection("order_collection");
    const usersCollection = db.collection("users");
    const reviewsCollection = db.collection("reviews");
    const favoritesCollection = db.collection("favorites");

    //verifyAdmin

    const verifyAdmin = async (req, res, next) => {
      const email = req.tokenEmail;

      const adminUser = await usersCollection.findOne({ email });

      if (!adminUser || adminUser.role !== "admin") {
        return res.status(403).send({ message: "Admin only access" });
      }

      next();
    };

    app.get("/test", async (req, res) => {
      res.json({ message: "route testing" });
    });

    // save meals in db

    app.post("/meals", async (req, res) => {
      const mealsData = req.body;
      const result = await mealsCollection.insertOne(mealsData);
      res.send(result);
    });

    //get all meals from db

    app.get("/meals", async (req, res) => {
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

    //find one data
    app.get("/meals/:id", async (req, res) => {
      const id = req.params.id;
      const result = await mealsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    //request Be a chef / admin

    app.post("/requests", verifyJWT, async (req, res) => {
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

    //  get all requests

    app.get("/requests", verifyJWT, async (req, res) => {
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

    //accept request chef / admin
    app.patch("/requests/approve/:id", verifyJWT, async (req, res) => {
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

      if (!request)
        return res.status(404).send({ message: "Request not found" });

      // role update
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

    //  reject request
    app.patch("/requests/reject/:id", verifyJWT, async (req, res) => {
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

    // order related api
    app.post("/orders", async (req, res) => {
      const orderData = req.body;
      orderData.status = "pending";
      orderData.paymentStatus = "pending";
      orderData.orderTime = new Date();
      const result = await ordersCollection.insertOne(orderData);
      res.send(result);
    });

    // loggedIn user orders

    app.get("/orders", async (req, res) => {
      const { chefEmail } = req.query;

      const query = chefEmail ? { chefEmail } : {};

      const result = await ordersCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/orders/user", verifyJWT, async (req, res) => {
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

    // payment related API

    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { orderId, totalPrice } = req.body;

        console.log("Payment Request:", orderId, totalPrice);

        if (!orderId || !totalPrice) {
          return res
            .status(400)
            .send({ error: "Missing orderId or totalPrice" });
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

    // update order status

    app.patch("/orders/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;

      const allowedStatus = ["pending", "accepted", "cancelled", "delivered"];

      if (!allowedStatus.includes(status)) {
        return res.status(400).send({ message: "Invalid status" });
      }

      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status,
        },
      };

      const result = await ordersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    //payment success
    app.post("/payment-success", async (req, res) => {
      try {
        const { orderId } = req.body;

        if (!orderId)
          return res.status(400).send({ error: "Order ID required" });

        // order update
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

    // users data save in db

    app.post("/users", async (req, res) => {
      const user = req.body;
      if (!user?.email) {
        return res.status(400).send({ message: "Email is required" });
      }
      const existingUser = await usersCollection.findOne({ email: user.email });
      if (existingUser) {
        return res.send({ message: "User already exists" });
      }
      user.role = "user";
      (user.status = "active"), (user.createdAt = new Date());
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    //get user role
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      if (!user) {
        return res.status(404).send({ role: null });
      }

      res.send({ role: user.role });
    });

    //get all user

    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    //make fraud api
    app.patch("/users/fraud/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "fraud" } }
      );

      res.send(result);
    });

    //save review db

    app.post("/reviews", async (req, res) => {
      const review = req.body;
      review.date = new Date();
      const result = await reviewsCollection.insertOne(review);
      res.send(result);
    });

    // get all reviews of a specific meal

    app.get("/reviews/:foodId", async (req, res) => {
      const foodId = req.params.foodId;
      const result = await reviewsCollection
        .find({ foodId })
        .sort({ date: -1 })
        .toArray();

      res.send(result);
    });

    // get all review for home page

    app.get("/reviews", async (req, res) => {
      const reviews = await reviewsCollection.find().toArray();
      res.send(reviews);
    });

    //Platform stats API

    app.get("/admin/stats", verifyJWT, verifyAdmin, async (req, res) => {
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

    //logged-in user reviews

    app.get("/my-reviews", async (req, res) => {
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

    //delete review api
    app.delete("/reviews/:id", async (req, res) => {
      const id = req.params.id;

      const result = await reviewsCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    //update review api
    app.patch("/reviews/:id", async (req, res) => {
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

    //add to favorite
    app.post("/favorites", async (req, res) => {
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

    //get user favorites api
    app.get("/favorites", async (req, res) => {
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

    //delete favorite meal
    app.delete("/favorites/:id", async (req, res) => {
      const id = req.params.id;

      const result = await favoritesCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    // get meals by logged-in chef
    app.get("/my-meals", verifyJWT, async (req, res) => {
      const email = req.query.email;

      if (req.tokenEmail !== email) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      const meals = await mealsCollection.find({ userEmail: email }).toArray();

      res.send(meals);
    });

    //delete meals api
    app.delete("/meals/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const result = await mealsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    //update meals api
    app.patch("/meals/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const updateDoc = { $set: req.body };
      const result = await mealsCollection.updateOne(
        { _id: new ObjectId(id) },
        updateDoc
      );
      res.send(result);
    });

    //get user profile
    app.get("/users/:email", verifyJWT, async (req, res) => {
      if (req.tokenEmail !== req.params.email) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      const user = await usersCollection.findOne({
        email: req.params.email,
      });

      res.send(user);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
