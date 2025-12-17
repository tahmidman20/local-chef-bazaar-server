const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 3000;

// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.1r2gfjh.mongodb.net/?appName=Cluster0`;

app.get("/", (req, res) => {
  res.send("Local bazaar server is running!");
});

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
    await client.connect();

    const db = client.db("mealsDB");
    const mealsCollection = db.collection("meals");
    const ordersCollection = db.collection("order_collection");
    const usersCollection = db.collection("users");
    const reviewsCollection = db.collection("reviews");

    // save meals in db

    app.post("/meals", async (req, res) => {
      const mealsData = req.body;
      const result = await mealsCollection.insertOne(mealsData);
      res.send(result);
    });

    //get all meals from db

    app.get("/meals", async (req, res) => {
      const result = await mealsCollection.find().toArray();
      res.send(result);
    });

    //find one data
    app.get("/meals/:id", async (req, res) => {
      const id = req.params.id;
      const result = await mealsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
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

    // logIn user orders
    app.get("/orders", async (req, res) => {
      const email = req.query.email;
      const query = email ? { userEmail: email } : {};
      const result = await ordersCollection.find(query).toArray();
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

    // ---------------------------------------------//
    //                 reviews                      //
    //----------------------------------------------//
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

    //get user profile
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send(user);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
